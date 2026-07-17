import { useEffect, useState } from 'react';
import type { KitVersion, KitVersionSummary } from '@zios/shared-types';
import { Badge, Button, Icon } from '@zios/ui';
import { kitsApi } from '../../../lib/kits-api';
import { userMessageForError } from '../../../lib/errors';
import { QUESTION_TYPE_LABELS } from '../../../lib/kit-utils';

/**
 * Versions drawer (FR-E2-5): every published snapshot is immutable — the
 * list plus an exact read-only view of the frozen definition, with the
 * reminder that invites/reports bind to a version forever.
 */

interface VersionsDrawerProps {
  open: boolean;
  kitId: string;
  onClose: () => void;
}

export function VersionsDrawer({ open, kitId, onClose }: VersionsDrawerProps) {
  const [versions, setVersions] = useState<KitVersionSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<KitVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setSelected(null);
    setShowJson(false);
    setError(undefined);
    kitsApi
      .listVersions(kitId)
      .then((response) => setVersions(response.versions))
      .catch((err) => setError(userMessageForError(err)));
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, kitId, onClose]);

  if (!open) return null;

  function openVersion(version: number) {
    setLoadingVersion(true);
    setShowJson(false);
    kitsApi
      .getVersion(kitId, version)
      .then((response) => setSelected(response.version))
      .catch((err) => setError(userMessageForError(err)))
      .finally(() => setLoadingVersion(false));
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Kit versions">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-surface-container-lowest shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-6 pb-4 border-b border-surface-variant/50">
          <div>
            <h2 className="text-headline-sm font-headline-sm text-primary">Published versions</h2>
            <p className="text-sm text-on-surface-variant mt-1 flex items-center gap-1.5">
              <Icon name="link" className="text-base" />
              Invites and reports bind to an exact version — snapshots never change.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close versions"
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-error/10 text-error text-sm rounded-xl px-4 py-3" role="alert">
              {error}
            </div>
          )}

          {versions === null ? (
            <div className="space-y-3" aria-label="Loading versions">
              {[0, 1].map((index) => (
                <div key={index} className="animate-pulse h-20 bg-surface-container rounded-2xl" />
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-3 py-16">
              <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                <Icon name="history" className="text-2xl text-outline" />
              </div>
              <p className="font-label-bold text-label-bold text-primary">No versions yet</p>
              <p className="text-sm text-on-surface-variant max-w-xs">
                Publish the kit to freeze its first immutable snapshot.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => openVersion(version.version)}
                    className={`w-full text-left bg-white border rounded-2xl p-4 flex items-center justify-between gap-3 transition-colors hover:border-primary/40 ${
                      selected?.version === version.version
                        ? 'border-primary'
                        : 'border-surface-variant/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-full bg-primary/10 text-primary font-label-bold flex items-center justify-center">
                        v{version.version}
                      </span>
                      <div>
                        <p className="text-sm font-label-bold text-on-surface">
                          Version {version.version}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          Published{' '}
                          {new Date(version.publishedAt).toLocaleString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                    <Icon name="chevron_right" className="text-on-surface-variant" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {loadingVersion && (
            <div
              className="mt-6 flex items-center gap-2 text-sm text-on-surface-variant"
              role="status"
            >
              <Icon name="progress_activity" className="animate-spin" /> Loading snapshot…
            </div>
          )}

          {selected && !loadingVersion && (
            <section className="mt-6" aria-label={`Version ${selected.version} snapshot`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-label-bold text-label-bold text-primary">
                  Version {selected.version} snapshot
                </h3>
                <div
                  className="flex gap-1 bg-surface-container-low rounded-lg p-0.5"
                  role="group"
                  aria-label="Snapshot view"
                >
                  <button
                    type="button"
                    onClick={() => setShowJson(false)}
                    className={`px-3 py-1 rounded-md text-xs font-label-bold transition-colors ${
                      !showJson ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    Rendered
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJson(true)}
                    className={`px-3 py-1 rounded-md text-xs font-label-bold transition-colors ${
                      showJson ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              {showJson ? (
                <pre className="bg-primary text-surface-container text-xs rounded-2xl p-4 overflow-x-auto max-h-[480px] overflow-y-auto">
                  {JSON.stringify(selected.snapshot, null, 2)}
                </pre>
              ) : (
                <div className="bg-white border border-surface-variant/50 rounded-2xl p-5 space-y-4">
                  <div>
                    <p className="font-headline-sm text-headline-sm text-primary">
                      {selected.snapshot.kit.title}
                    </p>
                    <p className="text-sm text-on-surface-variant">
                      {[selected.snapshot.kit.role, selected.snapshot.kit.level]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="primary">{selected.snapshot.kit.settings.mode}</Badge>
                      <Badge tone="neutral">
                        proctoring: {selected.snapshot.kit.settings.proctoringLevel}
                      </Badge>
                      <Badge tone="neutral">
                        est. {Math.round(selected.snapshot.durationEstimateSec / 60)} min
                      </Badge>
                    </div>
                  </div>
                  <ol className="space-y-3">
                    {selected.snapshot.questions.map((question, index) => (
                      <li
                        key={question.id}
                        className="border border-surface-variant/50 rounded-xl p-3"
                      >
                        <p className="text-sm text-on-surface">
                          <span className="font-label-bold text-primary mr-2">{index + 1}.</span>
                          {question.prompt}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge tone="neutral">{QUESTION_TYPE_LABELS[question.type]}</Badge>
                          <Badge tone="neutral">{question.topic}</Badge>
                          <Badge tone="neutral">{question.difficulty}</Badge>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="p-4 border-t border-surface-variant/50">
          <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </aside>
    </div>
  );
}
