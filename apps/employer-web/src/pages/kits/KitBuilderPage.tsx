import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import type {
  DurationEstimateResponse,
  Kit,
  KitDetailResponse,
  KitQuestion,
  KitSettings,
  KitVersionSummary,
  UpdateKitBody,
  UpdateQuestionBody,
} from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { kitsApi } from '../../lib/kits-api';
import { ApiRequestError } from '../../lib/api';
import { userMessageForError } from '../../lib/errors';
import { AutosaveController } from '../../lib/kit-autosave';
import { questionIndexFromPublishDetail } from '../../lib/kit-utils';
import { useToast } from '../../components/Toast';
import { kitStatusTone } from './KitsListPage';
import { KitSettingsRail } from './builder/KitSettingsRail';
import { SortableQuestionList } from './builder/SortableQuestionList';
import { BankPanel } from './builder/BankPanel';
import { VersionsDrawer } from './builder/VersionsDrawer';
import { BuilderFooter } from './builder/BuilderFooter';

/** Fields that belong to PATCH /kits/:id (everything else goes to /settings). */
const KIT_FIELD_KEYS = ['title', 'role', 'level'] as const;
const SETTINGS_KEYS: ReadonlyArray<keyof KitSettings> = [
  'mode',
  'language',
  'proctoringLevel',
  'introText',
  'outroText',
  'logoUrl',
  'totalTimeCapSec',
];

/** Combined patch surface the settings rail writes through (split per endpoint at send time). */
export type KitDraftPatch = Partial<Pick<Kit, 'title' | 'role' | 'level'>> & Partial<KitSettings>;

/** Type-safe dynamic write into a (partial) KitSettings object by key. */
function writeSetting(
  settings: Partial<KitSettings>,
  key: keyof KitSettings,
  value: unknown,
): void {
  (settings as unknown as Record<string, unknown>)[key] = value;
}

/**
 * /kits/:id — the kit builder (FR-E2-1): settings rail + ordered question
 * cards with drag reorder, debounced autosave under the api's optimistic-
 * concurrency contract, question-bank inserts, duration estimate, publish,
 * versions and archive actions.
 */
export function KitBuilderPage() {
  const { kitId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [detail, setDetail] = useState<KitDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
  const [bankOpen, setBankOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [estimate, setEstimate] = useState<DurationEstimateResponse | null>(null);
  const [publishErrors, setPublishErrors] = useState<string[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<KitVersionSummary | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const detailRef = useRef<KitDetailResponse | null>(null);
  const kitSaverRef = useRef<AutosaveController<KitDraftPatch, Kit> | null>(null);
  const questionSaversRef = useRef(
    new Map<string, AutosaveController<UpdateQuestionBody, KitQuestion>>(),
  );
  const dirtySetRef = useRef(new Set<string>());

  /* ------------------------------------------------------------------ *
   * Dirty tracking (drives the unsaved-changes route guard)            *
   * ------------------------------------------------------------------ */
  const setDirtyKey = useCallback((key: string, dirty: boolean) => {
    const set = dirtySetRef.current;
    if (dirty === set.has(key)) return;
    if (dirty) set.add(key);
    else set.delete(key);
    setDirtyKeys(new Set(set));
  }, []);

  const dirty = dirtyKeys.size > 0;
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function destroySavers() {
    kitSaverRef.current?.destroy();
    kitSaverRef.current = null;
    for (const saver of questionSaversRef.current.values()) saver.destroy();
    questionSaversRef.current.clear();
    dirtySetRef.current.clear();
    setDirtyKeys(new Set());
  }

  useEffect(() => () => destroySavers(), []);

  /* ------------------------------------------------------------------ *
   * Server-truth application with pending-edit shields                 *
   * ------------------------------------------------------------------ */

  /** Merges fresh server state into local state without clobbering fields
   *  that have unsent edits pending in an autosave controller. */
  const applyServerDetail = useCallback((fresh: KitDetailResponse) => {
    kitSaverRef.current?.setOwner(fresh.kit);
    setDetail((prev) => {
      const kitPending = new Set(kitSaverRef.current?.pendingKeys ?? []);
      const kit: Kit = {
        ...fresh.kit,
        title: kitPending.has('title') && prev ? prev.kit.title : fresh.kit.title,
        role: kitPending.has('role') && prev ? prev.kit.role : fresh.kit.role,
        level: kitPending.has('level') && prev ? prev.kit.level : fresh.kit.level,
        settings: { ...fresh.kit.settings },
      };
      if (prev) {
        for (const key of SETTINGS_KEYS) {
          if (kitPending.has(key)) {
            writeSetting(kit.settings, key, prev.kit.settings[key]);
          }
        }
      }
      const questions = fresh.questions.map((freshQuestion) => {
        const saver = questionSaversRef.current.get(freshQuestion.id);
        const pending = new Set(saver?.pendingKeys ?? []);
        if (pending.size === 0 || !prev) return freshQuestion;
        const local = prev.questions.find((q) => q.id === freshQuestion.id);
        if (!local) return freshQuestion;
        const merged = { ...freshQuestion };
        for (const key of pending) {
          (merged as unknown as Record<string, unknown>)[key] = local[key as keyof KitQuestion];
        }
        return merged;
      });
      return { kit, questions, topics: fresh.topics };
    });
  }, []);

  const refreshDetail = useCallback(async () => {
    const fresh = await kitsApi.getDetail(kitId);
    applyServerDetail(fresh);
  }, [kitId, applyServerDetail]);

  /* ------------------------------------------------------------------ *
   * Initial load + autosave controllers                                *
   * ------------------------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;

    async function sendKitPatch(patch: KitDraftPatch, expectedUpdatedAt: string): Promise<Kit> {
      const kitBody: UpdateKitBody = {};
      if (KIT_FIELD_KEYS.some((key) => key in patch)) {
        if ('title' in patch) kitBody.title = patch.title;
        if ('role' in patch) kitBody.role = patch.role ?? null;
        if ('level' in patch) kitBody.level = patch.level ?? null;
      }
      const settingsBody: Partial<KitSettings> = {};
      for (const key of SETTINGS_KEYS) {
        if (key in patch) {
          writeSetting(settingsBody as KitSettings, key, patch[key]);
        }
      }

      let current = expectedUpdatedAt;
      let kit: Kit | null = null;
      if (Object.keys(kitBody).length > 0) {
        const response = await kitsApi.update(kitId, {
          ...kitBody,
          expectedUpdatedAt: current,
        });
        kit = response.kit;
        current = kit.updatedAt;
      }
      if (Object.keys(settingsBody).length > 0) {
        const response = await kitsApi.updateSettings(kitId, {
          ...settingsBody,
          expectedUpdatedAt: current,
        });
        kit = response.kit;
      }
      if (!kit) throw new Error('empty kit patch');
      return kit;
    }

    kitsApi
      .getDetail(kitId)
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        detailRef.current = loaded;

        const kitSaver = new AutosaveController<KitDraftPatch, Kit>(loaded.kit, {
          send: sendKitPatch,
          refetch: async () => {
            const fresh = await kitsApi.getDetail(kitId);
            applyServerDetail(fresh);
            return fresh.kit;
          },
          getUpdatedAt: (kit) => kit.updatedAt,
          onSaved: (freshKit) => {
            setDetail((prev) => {
              if (!prev) return prev;
              const pending = new Set(kitSaver.pendingKeys);
              const kit: Kit = {
                ...freshKit,
                title: pending.has('title') ? prev.kit.title : freshKit.title,
                role: pending.has('role') ? prev.kit.role : freshKit.role,
                level: pending.has('level') ? prev.kit.level : freshKit.level,
                settings: { ...freshKit.settings },
              };
              for (const key of SETTINGS_KEYS) {
                if (pending.has(key)) {
                  writeSetting(kit.settings, key, prev.kit.settings[key]);
                }
              }
              return { ...prev, kit };
            });
          },
          onConflict: () =>
            toast.push('This kit was updated elsewhere — your changes were re-applied.', 'info'),
          onError: (message) => toast.push(message, 'error'),
          onDirtyChange: (isDirty) => setDirtyKey('kit', isDirty),
        });
        kitSaverRef.current = kitSaver;
      })
      .catch((err) => {
        if (!cancelled) setLoadError(userMessageForError(err));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  function getQuestionSaver(
    question: KitQuestion,
  ): AutosaveController<UpdateQuestionBody, KitQuestion> {
    const existing = questionSaversRef.current.get(question.id);
    if (existing) return existing;

    const saver = new AutosaveController<UpdateQuestionBody, KitQuestion>(question, {
      send: async (patch, expectedUpdatedAt) => {
        const response = await kitsApi.updateQuestion(kitId, question.id, {
          ...patch,
          expectedUpdatedAt,
        });
        return response.question;
      },
      refetch: async () => {
        const fresh = await kitsApi.getDetail(kitId);
        applyServerDetail(fresh);
        const found = fresh.questions.find((q) => q.id === question.id);
        if (!found) throw new ApiRequestError(404, 'QUESTION_NOT_FOUND', 'question not found');
        return found;
      },
      getUpdatedAt: (q) => q.updatedAt,
      onSaved: (freshQuestion) => {
        setDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            questions: prev.questions.map((q) => {
              if (q.id !== freshQuestion.id) return q;
              const pending = new Set(saver.pendingKeys);
              const merged = { ...freshQuestion };
              for (const key of pending) {
                (merged as unknown as Record<string, unknown>)[key] = q[key as keyof KitQuestion];
              }
              return merged;
            }),
          };
        });
      },
      onConflict: () =>
        toast.push('A question was updated elsewhere — your changes were re-applied.', 'info'),
      onError: (message) => toast.push(message, 'error'),
      onDirtyChange: (isDirty) => setDirtyKey(`q:${question.id}`, isDirty),
    });
    questionSaversRef.current.set(question.id, saver);
    return saver;
  }

  /* ------------------------------------------------------------------ *
   * Edit actions (optimistic state + debounced autosave)               *
   * ------------------------------------------------------------------ */
  function patchKit(patch: KitDraftPatch) {
    setDetail((prev) => {
      if (!prev) return prev;
      const kit: Kit = { ...prev.kit, settings: { ...prev.kit.settings } };
      if ('title' in patch) kit.title = patch.title ?? kit.title;
      if ('role' in patch) kit.role = patch.role ?? null;
      if ('level' in patch) kit.level = patch.level ?? null;
      for (const key of SETTINGS_KEYS) {
        if (key in patch) {
          writeSetting(kit.settings, key, patch[key]);
        }
      }
      return { ...prev, kit };
    });
    kitSaverRef.current?.schedule(patch);
  }

  function patchQuestion(questionId: string, patch: UpdateQuestionBody) {
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === questionId ? { ...q, ...patch } : q)),
      };
    });
    const question = detailRef.current?.questions.find((q) => q.id === questionId);
    if (question) getQuestionSaver(question).schedule(patch);
  }

  async function flushAllSavers(): Promise<void> {
    await kitSaverRef.current?.flushNow();
    await Promise.all([...questionSaversRef.current.values()].map((saver) => saver.flushNow()));
  }

  /* ------------------------------------------------------------------ *
   * Structural operations (flush first, then resync kit.updatedAt)     *
   * ------------------------------------------------------------------ */
  async function handleAddQuestion() {
    await flushAllSavers();
    try {
      const response = await kitsApi.addQuestion(kitId, {
        type: 'open_ended',
        prompt: 'New question',
        topic: detailRef.current?.topics[0] ?? 'General',
        rubricLines: [{ id: 'r1', text: 'Overall answer quality', weight: 1 }],
      });
      setLastAddedId(response.question.id);
      await refreshDetail();
    } catch (err) {
      toast.push(userMessageForError(err), 'error');
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    await flushAllSavers();
    const saver = questionSaversRef.current.get(questionId);
    saver?.destroy();
    questionSaversRef.current.delete(questionId);
    dirtySetRef.current.delete(`q:${questionId}`);
    setDirtyKeys(new Set(dirtySetRef.current));
    try {
      await kitsApi.deleteQuestion(kitId, questionId);
      await refreshDetail();
      toast.push('Question removed.', 'info');
    } catch (err) {
      toast.push(userMessageForError(err), 'error');
      await refreshDetail().catch(() => undefined);
    }
  }

  async function handleReorder(questionIds: string[]) {
    // Optimistic local order; the server rebases fractional positions.
    setDetail((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.questions.map((q) => [q.id, q]));
      const questions = questionIds
        .map((id) => byId.get(id))
        .filter((q): q is KitQuestion => q !== undefined);
      return { ...prev, questions };
    });
    await flushAllSavers();
    try {
      await kitsApi.reorderQuestions(kitId, questionIds);
      await refreshDetail();
    } catch (err) {
      toast.push(userMessageForError(err), 'error');
      await refreshDetail().catch(() => undefined);
    }
  }

  async function handleInsertFromBank(bankItemId: string): Promise<void> {
    await flushAllSavers();
    const response = await kitsApi.cloneFromBank(kitId, { bankItemId });
    setLastAddedId(response.question.id);
    await refreshDetail();
    toast.push('Question added from the bank.', 'success');
  }

  /* ------------------------------------------------------------------ *
   * Publish / archive                                                  *
   * ------------------------------------------------------------------ */
  async function handlePublish() {
    setPublishing(true);
    setPublishErrors(null);
    setPublishedVersion(null);
    try {
      await flushAllSavers();
      const response = await kitsApi.publish(kitId);
      setPublishedVersion(response.version);
      toast.push(`Published version ${response.version.version}.`, 'success');
      await refreshDetail();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'PUBLISH_VALIDATION_FAILED') {
        const details = err.details.details;
        setPublishErrors(Array.isArray(details) ? (details as string[]) : [err.message]);
      } else {
        toast.push(userMessageForError(err), 'error');
      }
    } finally {
      setPublishing(false);
    }
  }

  async function handleArchiveToggle() {
    if (!detail) return;
    setArchiving(true);
    try {
      if (detail.kit.status === 'archived') {
        await kitsApi.unarchive(kitId);
        toast.push('Kit restored from the archive.', 'success');
        await refreshDetail();
      } else {
        await flushAllSavers();
        await kitsApi.archive(kitId);
        toast.push('Kit archived.', 'info');
        navigate('/kits');
      }
    } catch (err) {
      toast.push(userMessageForError(err), 'error');
    } finally {
      setArchiving(false);
    }
  }

  /* ------------------------------------------------------------------ *
   * Duration estimate (debounced refetch on time-relevant changes)     *
   * ------------------------------------------------------------------ */
  const estimateSignature = useMemo(() => {
    if (!detail) return '';
    return JSON.stringify({
      ids: detail.questions.map((q) => q.id),
      limits: detail.questions.map((q) => q.timeLimitSec),
      cap: detail.kit.settings.totalTimeCapSec,
    });
  }, [detail]);

  useEffect(() => {
    if (!detail) return undefined;
    const timer = window.setTimeout(() => {
      kitsApi
        .durationEstimate(kitId)
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateSignature, kitId]);

  /* ------------------------------------------------------------------ *
   * Render                                                             *
   * ------------------------------------------------------------------ */
  if (loadError) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-16 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not open this kit</p>
          <p className="text-sm text-on-surface-variant">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/kits')}>
            Back to kits
          </Button>
        </Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-container-max mx-auto animate-pulse" aria-label="Loading kit">
        <div className="h-8 w-64 bg-surface-container rounded mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          <div className="h-96 bg-surface-container rounded-2xl" />
          <div className="space-y-4">
            <div className="h-40 bg-surface-container rounded-2xl" />
            <div className="h-40 bg-surface-container rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const { kit, questions, topics } = detail;
  const archived = kit.status === 'archived';

  return (
    <div className="max-w-container-max mx-auto pb-24">
      {/* Header */}
      <section className="mb-6">
        <Link
          to="/kits"
          className="text-primary font-label-bold text-sm inline-flex items-center gap-1 hover:underline mb-3"
        >
          <Icon name="arrow_back" className="text-sm" /> All kits
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-headline-md text-headline-md text-primary truncate">{kit.title}</h2>
            <Badge tone={kitStatusTone(kit.status)}>{kit.status}</Badge>
            {dirty && (
              <span
                className="text-xs text-on-surface-variant inline-flex items-center gap-1"
                role="status"
              >
                <Icon name="sync" className="text-sm animate-spin" /> Saving…
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon="history"
              onClick={() => setVersionsOpen(true)}
            >
              Versions
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon="visibility"
              onClick={() => navigate(`/kits/${kitId}/preview`)}
            >
              Preview as candidate
            </Button>
            {!archived && (
              <Button
                variant="secondary"
                size="sm"
                icon="menu_book"
                onClick={() => setBankOpen(true)}
              >
                Question bank
              </Button>
            )}
          </div>
        </div>
      </section>

      {archived && (
        <Card
          padding="md"
          className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-amber-200 bg-amber-50"
        >
          <div className="flex items-center gap-3">
            <Icon name="archive" className="text-amber-700" />
            <p className="text-sm text-on-surface">
              This kit is <span className="font-label-bold">archived</span> — it is read-only.
              Unarchive it to keep editing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="unarchive"
            loading={archiving}
            onClick={() => void handleArchiveToggle()}
          >
            Unarchive
          </Button>
        </Card>
      )}

      {publishedVersion && (
        <Card
          padding="md"
          className="mb-6 flex items-center justify-between gap-3 border-success/40 bg-[#eefaf3]"
          role="status"
        >
          <div className="flex items-center gap-3">
            <Icon name="check_circle" className="text-success" filled />
            <p className="text-sm text-on-surface">
              <span className="font-label-bold">Version {publishedVersion.version} published.</span>{' '}
              The snapshot is frozen — invites and reports will bind to it forever.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
            View versions
          </Button>
        </Card>
      )}

      {publishErrors && (
        <Card padding="md" className="mb-6 border-error/40 bg-[#fff5f5]" role="alert">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Icon name="error" className="text-error mt-0.5" />
              <div>
                <p className="font-label-bold text-label-bold text-error mb-2">
                  Publish failed — fix these and try again
                </p>
                <ul className="space-y-1.5 text-sm text-on-surface">
                  {publishErrors.map((message, index) => {
                    const questionIndex = questionIndexFromPublishDetail(message);
                    return (
                      <li key={index} className="flex items-start gap-2">
                        <span aria-hidden="true">•</span>
                        {questionIndex !== null && questionIndex <= questions.length ? (
                          <a
                            href={`#question-${questionIndex}`}
                            className="underline decoration-dotted underline-offset-2 hover:text-primary"
                            onClick={(event) => {
                              event.preventDefault();
                              document
                                .getElementById(`question-${questionIndex}`)
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                          >
                            {message}
                          </a>
                        ) : (
                          <span>{message}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss publish errors"
              onClick={() => setPublishErrors(null)}
              className="p-1 text-on-surface-variant hover:text-primary transition-colors"
            >
              <Icon name="close" />
            </button>
          </div>
        </Card>
      )}

      {/* Main grid: settings rail + question list */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8 items-start">
        <KitSettingsRail kit={kit} disabled={archived} onPatch={patchKit} />

        <section aria-label="Questions">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline-sm text-headline-sm text-primary">
              Questions{' '}
              <span className="text-on-surface-variant text-base font-body-md">
                ({questions.length})
              </span>
            </h3>
            {!archived && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  icon="menu_book"
                  onClick={() => setBankOpen(true)}
                >
                  Insert from bank
                </Button>
                <Button size="sm" icon="add" onClick={() => void handleAddQuestion()}>
                  Add question
                </Button>
              </div>
            )}
          </div>

          {questions.length === 0 ? (
            <Card className="p-12 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                <Icon name="quiz" className="text-2xl text-outline" />
              </div>
              <p className="font-label-bold text-label-bold text-primary">No questions yet</p>
              <p className="text-sm text-on-surface-variant max-w-sm">
                Add your first question, or insert a proven one from the question bank.
              </p>
              {!archived && (
                <div className="flex gap-3 mt-2">
                  <Button size="sm" icon="add" onClick={() => void handleAddQuestion()}>
                    Add question
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="menu_book"
                    onClick={() => setBankOpen(true)}
                  >
                    Browse bank
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <SortableQuestionList
              questions={questions}
              topics={topics}
              disabled={archived}
              savingIds={
                new Set([...dirtyKeys].filter((k) => k.startsWith('q:')).map((k) => k.slice(2)))
              }
              publishErrorIndexes={
                new Set(
                  (publishErrors ?? [])
                    .map(questionIndexFromPublishDetail)
                    .filter((i): i is number => i !== null),
                )
              }
              lastAddedId={lastAddedId}
              onPatch={patchQuestion}
              onDelete={(questionId) => void handleDeleteQuestion(questionId)}
              onReorder={(ids) => void handleReorder(ids)}
            />
          )}
        </section>
      </div>

      <BuilderFooter
        kit={kit}
        estimate={estimate}
        publishing={publishing}
        archiving={archiving}
        onPublish={() => void handlePublish()}
        onArchiveToggle={() => void handleArchiveToggle()}
      />

      <BankPanel
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        onInsert={handleInsertFromBank}
      />
      <VersionsDrawer open={versionsOpen} kitId={kitId} onClose={() => setVersionsOpen(false)} />

      {/* Unsaved-changes route guard */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Unsaved changes"
            className="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-xl border border-surface-variant/50 p-8 space-y-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center">
                <Icon name="save" className="text-secondary" />
              </div>
              <h2 className="text-headline-sm font-headline-sm text-primary">
                Saving your changes…
              </h2>
            </div>
            <p className="text-sm text-on-surface-variant">
              An autosave is still in flight. Wait a moment for it to finish, or leave anyway — the
              last keystrokes may be lost.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={() => blocker.reset()}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  destroySavers();
                  blocker.proceed();
                }}
              >
                Leave anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
