import { useEffect } from 'react';
import { Button, Icon } from '@zios/ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /** danger tones the confirm button (revoke/delete-class actions). */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation popup for destructive/lifecycle actions (extend link,
 * reissue link, rotate/revoke API key). Rendered at the page level so the
 * fixed overlay centers against the viewport (AppShell must not carry a
 * transform — see the SendInterviewDialog clip fix).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-3xl border border-surface-variant/50 bg-surface-container-lowest p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              tone === 'danger' ? 'bg-error/10' : 'bg-primary/10'
            }`}
          >
            <Icon
              name={tone === 'danger' ? 'error' : 'help'}
              className={`text-xl ${tone === 'danger' ? 'text-error' : 'text-primary'}`}
            />
          </div>
          <div>
            <p className="font-bold text-on-surface">{title}</p>
            <p className="mt-1 text-sm text-on-surface-variant">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            loading={busy}
            className={
              tone === 'danger'
                ? 'bg-error text-on-error hover:bg-error/90'
                : undefined
            }
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
