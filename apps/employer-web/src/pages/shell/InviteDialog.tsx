import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppUserRole } from '@zios/shared-types';
import { Button, Icon, Input } from '@zios/ui';
import { authApi } from '../../lib/auth-api';
import { userMessageForError } from '../../lib/errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Admin-only teammate invite (FR-E1-3): POST /orgs/current/invites. The raw
 * token only travels in the invite email (Mailpit in dev), never back here.
 */
export function InviteDialog({ open, onClose }: InviteDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppUserRole>('interviewer');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setEmail('');
    setRole('interviewer');
    setError(undefined);
    setSent(false);
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      await authApi.createInvite({ email: trimmed, role });
      setSent(true);
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setSending(false);
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Invite team member"
        className="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-xl border border-surface-variant/50 p-8 space-y-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-headline-sm font-headline-sm text-primary">Invite team member</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              They will receive an email with a sign-in link for your workspace.
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

        {sent ? (
          <div className="space-y-6 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <Icon name="mark_email_read" className="text-3xl text-success" filled />
            </div>
            <p className="text-body-md text-on-surface-variant">
              Invite sent to <span className="font-bold text-on-surface">{email.trim()}</span>. The
              link expires in 7 days.
            </p>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <Input
              id="invite-email"
              label="Email Address"
              icon="mail"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              error={error}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(undefined);
              }}
            />

            <div className="space-y-1.5">
              <label htmlFor="invite-role" className="text-sm font-bold leading-none text-primary">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as AppUserRole)}
                className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface"
              >
                <option value="interviewer">Interviewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <Button type="submit" size="lg" className="w-full" icon="send" loading={sending}>
              Send invite
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
