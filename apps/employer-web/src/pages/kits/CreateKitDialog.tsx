import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InterviewMode } from '@zios/shared-types';
import { Button, Icon, Input } from '@zios/ui';
import { kitsApi } from '../../lib/kits-api';
import { userMessageForError } from '../../lib/errors';

export interface CreateKitDialogProps {
  open: boolean;
  onClose: () => void;
}

const MODE_OPTIONS: Array<{ value: InterviewMode; label: string }> = [
  { value: 'text', label: 'Text interview' },
  { value: 'voice', label: 'Voice interview' },
  { value: 'video', label: 'Video interview' },
];

/**
 * Quick create (FR-E2-1): title + role + level + mode → POST /kits, then
 * straight into the builder. The template gallery (/kits/new) is the
 * richer starting point.
 */
export function CreateKitDialog({ open, onClose }: CreateKitDialogProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [level, setLevel] = useState('');
  const [mode, setMode] = useState<InterviewMode>('text');
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    setTitle('');
    setRole('');
    setLevel('');
    setMode('text');
    setError(undefined);
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0) {
      setError('Give the kit a title.');
      return;
    }
    setError(undefined);
    setCreating(true);
    try {
      const { kit } = await kitsApi.create({
        title: title.trim(),
        role: role.trim() || undefined,
        level: level.trim() || undefined,
        settings: { mode },
      });
      onClose();
      navigate(`/kits/${kit.id}`);
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create interview kit"
        className="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-xl border border-surface-variant/50 p-8 space-y-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-headline-sm font-headline-sm text-primary">New interview kit</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              A kit is the ordered set of questions candidates answer. You can publish it once it is
              ready.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="close" />
          </button>
        </div>

        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Input
            id="kit-title"
            label="Kit title"
            icon="assignment"
            placeholder="e.g. Backend Engineer — Screening"
            value={title}
            error={error}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(undefined);
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="kit-role" className="text-sm font-bold leading-none text-primary">
                Role
              </label>
              <input
                id="kit-role"
                className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface"
                placeholder="Backend Engineer"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="kit-level" className="text-sm font-bold leading-none text-primary">
                Level
              </label>
              <input
                id="kit-level"
                className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface"
                placeholder="Mid-level"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="kit-mode" className="text-sm font-bold leading-none text-primary">
              Interview mode
            </label>
            <select
              id="kit-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as InterviewMode)}
              className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface"
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => {
                onClose();
                navigate('/kits/new');
              }}
            >
              Browse templates
            </Button>
            <Button type="submit" size="lg" className="flex-1" icon="add" loading={creating}>
              Create kit
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
