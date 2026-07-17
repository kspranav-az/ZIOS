import { useEffect, useRef, useState } from 'react';
import type { BankSearchResponse, QuestionBankItem } from '@zios/shared-types';
import { Badge, Button, Icon } from '@zios/ui';
import { searchBank } from '../../../lib/kits-api';
import { userMessageForError } from '../../../lib/errors';
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from '../../../lib/kit-utils';

/**
 * Question-bank slide-over (FR-E4-1): search + role-family/topic/type/
 * difficulty filters, 50-per-page results, one-click insert into the kit
 * (search → Insert = well under 3 clicks). Inserts clone server-side with
 * provenance source 'bank' (FR-E4-3).
 */

const ROLE_FAMILIES = [
  'campus-fresher-general',
  'customer-support',
  'engineering-backend',
  'engineering-data',
  'engineering-devops',
  'engineering-frontend',
  'engineering-fullstack',
  'engineering-qa',
  'finance',
  'hr-ops',
  'marketing',
  'product-management',
  'sales',
];

interface BankPanelProps {
  open: boolean;
  onClose: () => void;
  onInsert: (bankItemId: string) => Promise<void>;
}

export function BankPanel({ open, onClose, onInsert }: BankPanelProps) {
  const [query, setQuery] = useState('');
  const [roleFamily, setRoleFamily] = useState('');
  const [topic, setTopic] = useState('');
  const [type, setType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<BankSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [insertedIds, setInsertedIds] = useState<ReadonlySet<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset and focus when opened.
  useEffect(() => {
    if (!open) return;
    setInsertedIds(new Set());
    window.setTimeout(() => searchInputRef.current?.focus(), 120);
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  // Debounced search on any filter change.
  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchBank({
        query: query || undefined,
        roleFamily: roleFamily || undefined,
        topic: topic || undefined,
        type: type || undefined,
        difficulty: difficulty || undefined,
        page,
      })
        .then((response) => {
          setResult(response);
          setError(undefined);
        })
        .catch((err) => setError(userMessageForError(err)))
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, query, roleFamily, topic, type, difficulty, page]);

  // Any filter change restarts at page 1 (page itself excluded from reset).
  const filterKey = `${query}|${roleFamily}|${topic}|${type}|${difficulty}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setPage(1);
    }
  }, [filterKey]);

  if (!open) return null;

  async function handleInsert(item: QuestionBankItem) {
    setInsertingId(item.id);
    try {
      await onInsert(item.id);
      setInsertedIds((prev) => new Set([...prev, item.id]));
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setInsertingId(null);
    }
  }

  const selectClasses =
    'px-3 py-2 bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none text-xs text-on-surface';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Question bank">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface-container-lowest shadow-2xl flex flex-col animate-[slide-in-right_200ms_ease]">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-surface-variant/50">
          <div>
            <h2 className="text-headline-sm font-headline-sm text-primary">Question bank</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Proven, rubric-tagged questions — inserted with one click.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close question bank"
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="p-6 pt-4 space-y-3 border-b border-surface-variant/50">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg"
            />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search question bank"
              placeholder="Search prompts and topics…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2.5 text-on-surface focus:ring-2 focus:ring-primary/10 transition-all font-body-md text-sm outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filter by role family"
              value={roleFamily}
              onChange={(event) => setRoleFamily(event.target.value)}
              className={selectClasses}
            >
              <option value="">All role families</option>
              {ROLE_FAMILIES.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={selectClasses}
            >
              <option value="">All types</option>
              {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
              className={selectClasses}
            >
              <option value="">All difficulties</option>
              {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label="Filter by topic"
              placeholder="Topic…"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className={`${selectClasses} w-32`}
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {error && (
            <div className="mb-4 bg-error/10 text-error text-sm rounded-xl px-4 py-3" role="alert">
              {error}
            </div>
          )}
          {loading && !result ? (
            <div className="space-y-3" aria-label="Searching bank">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="animate-pulse h-28 bg-surface-container rounded-2xl" />
              ))}
            </div>
          ) : result && result.items.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-3 py-16">
              <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                <Icon name="search_off" className="text-2xl text-outline" />
              </div>
              <p className="font-label-bold text-label-bold text-primary">No matching questions</p>
              <p className="text-sm text-on-surface-variant">
                Try fewer filters or a broader search.
              </p>
            </div>
          ) : (
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
              {result?.items.map((item) => {
                const inserted = insertedIds.has(item.id);
                return (
                  <li
                    key={item.id}
                    className="bg-white border border-surface-variant/50 rounded-2xl p-4"
                  >
                    <p className="text-sm text-on-surface leading-relaxed">{item.prompt}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone="primary">{item.roleFamily}</Badge>
                      <Badge tone="neutral">{item.topic}</Badge>
                      <Badge tone="neutral">{QUESTION_TYPE_LABELS[item.type]}</Badge>
                      <Badge
                        tone={
                          item.difficulty === 'hard'
                            ? 'error'
                            : item.difficulty === 'medium'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {DIFFICULTY_LABELS[item.difficulty]}
                      </Badge>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant={inserted ? 'outline' : 'primary'}
                        icon={inserted ? 'check' : 'add'}
                        disabled={inserted}
                        loading={insertingId === item.id}
                        onClick={() => void handleInsert(item)}
                      >
                        {inserted ? 'Inserted' : 'Insert'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {result && result.totalPages > 1 && (
          <div className="p-4 border-t border-surface-variant/50 flex items-center justify-between">
            <span className="text-xs text-on-surface-variant">
              Page {result.page} of {result.totalPages} · {result.total} questions
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                icon="chevron_left"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon="chevron_right"
                disabled={page >= result.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
