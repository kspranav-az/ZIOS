import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon } from '@zios/ui';
import type { PracticeMode } from '@zios/shared-types';
import {
  ApiErrorResponse,
  createPractice,
  fetchPracticeLibrary,
  storePracticeRecovery,
  type PracticeLibraryResponse,
} from '../api';
import { PageShell } from '../components/PageShell';

/** Pack picker + mode select → creates the session and routes to consent. */
export function PracticeSetupPage() {
  const navigate = useNavigate();
  const [library, setLibrary] = useState<PracticeLibraryResponse | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [mode, setMode] = useState<PracticeMode>('text');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPracticeLibrary()
      .then(setLibrary)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load practice packs.'),
      );
  }, []);

  const handleStart = async () => {
    if (!packId) return;
    setLoading(true);
    setError(null);
    try {
      const { session, recoveryToken } = await createPractice({ packId, mode });
      storePracticeRecovery(session.id, recoveryToken);
      navigate(`/practice/${session.id}/consent`, { state: { session, consent: library?.consent } });
    } catch (err) {
      if (err instanceof ApiErrorResponse && err.statusCode === 429) {
        setError('You have hit today’s practice limit (3 completed mocks per day). Come back tomorrow!');
      } else if (err instanceof ApiErrorResponse && err.statusCode === 402) {
        setError('You are out of practice credits. Credits are granted during the closed beta — contact support.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not start the mock. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-headline-sm text-on-surface">Practice mock interview</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Pick a starter pack. A text mock costs 1 credit.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {(library?.packs ?? []).map((pack) => {
            const selected = packId === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setPackId(pack.id)}
                className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary-container/30'
                    : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant'
                  }`}
                >
                  {selected && <Icon name="check" className="text-sm" />}
                </span>
                <span>
                  <span className="block font-bold text-on-surface">{pack.title}</span>
                  <span className="mt-1 block text-body-md text-on-surface-variant">
                    {pack.description} · {pack.questions.length} questions
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          <p className="text-label-bold uppercase tracking-wide text-on-surface-variant">Mode</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setMode('text')}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === 'text'
                  ? 'border-primary bg-primary-container/30'
                  : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
              }`}
            >
              <span className="block font-bold text-on-surface">Text</span>
              <span className="block text-body-sm text-on-surface-variant">1 credit</span>
            </button>
            <div
              className="cursor-not-allowed rounded-xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 opacity-60"
              title="Voice mocks arrive in a later beta drop"
            >
              <span className="block font-bold text-on-surface">Voice</span>
              <span className="block text-body-sm text-on-surface-variant">
                Coming in a later beta drop
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Button size="lg" disabled={!packId || loading} loading={loading} onClick={() => void handleStart()} icon="play_arrow">
            Continue to consent
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
