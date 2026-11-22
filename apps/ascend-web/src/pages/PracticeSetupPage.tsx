import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { PracticeMode } from '@zios/shared-types';
import {
  ApiErrorResponse,
  createPractice,
  createPracticeFromJd,
  extractPracticeJd,
  fetchPracticeLibrary,
  storePracticeRecovery,
  type PracticeLibraryResponse,
} from '../api';

/** Pack picker or JD paste → creates the session and routes to consent. */
export function PracticeSetupPage() {
  const navigate = useNavigate();
  const [library, setLibrary] = useState<PracticeLibraryResponse | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [mode, setMode] = useState<PracticeMode>('text');
  const [jdText, setJdText] = useState('');
  const [jdExtracting, setJdExtracting] = useState(false);
  const [jdNotice, setJdNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPracticeLibrary()
      .then(setLibrary)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load practice packs.'),
      );
  }, []);

  const routeToConsent = (session: { id: string }, recoveryToken: string) => {
    storePracticeRecovery(session.id, recoveryToken);
    navigate(`/practice/${session.id}/consent`, { state: { session, consent: library?.consent } });
  };

  const friendlyError = (err: unknown): string => {
    if (err instanceof ApiErrorResponse && err.statusCode === 429) {
      return 'You have hit today’s practice limit (3 completed mocks per day). Come back tomorrow!';
    }
    if (err instanceof ApiErrorResponse && err.statusCode === 402) {
      return 'You are out of practice credits. Credits are granted during the closed beta — contact support.';
    }
    return err instanceof Error ? err.message : 'Could not start the mock. Please try again.';
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleJdFile = async (file: File) => {
    setError(null);
    setJdNotice(null);
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.txt')) {
      setError('Upload a .txt or .pdf JD — or paste the plain text below.');
      return;
    }
    setJdExtracting(true);
    try {
      const { text } = await extractPracticeJd({
        fileName: file.name,
        contentBase64: await fileToBase64(file),
      });
      setJdText(text);
      setJdNotice('JD extracted — review and edit the text below if needed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file. Paste the JD text instead.');
    } finally {
      setJdExtracting(false);
    }
  };

  const handleStart = async () => {
    if (!packId) return;
    setLoading(true);
    setError(null);
    try {
      const { session, recoveryToken } = await createPractice({ packId, mode });
      routeToConsent(session, recoveryToken);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFromJd = async () => {
    setLoading(true);
    setError(null);
    try {
      const { session, recoveryToken } = await createPracticeFromJd({ jdText, mode });
      routeToConsent(session, recoveryToken);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-headline-sm text-on-surface">Practice mock interview</h1>
      <p className="mt-1 text-body-md text-on-surface-variant">
        Pick a starter pack. Text mock 1 credit · voice mock 2 credits · live room 3 credits.
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

      <Card padding="lg" radius="2xl" className="mt-8">
        <h2 className="text-title-md text-on-surface">Or target a real job description</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Upload or paste a JD and we will generate questions for it — if you have a resume on
          file, one question will probe the biggest gap.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            id="jd-file"
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleJdFile(file);
              e.target.value = '';
            }}
          />
          <label
            htmlFor="jd-file"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 text-body-md font-bold text-on-surface transition-colors hover:bg-surface-container ${
              jdExtracting ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {jdExtracting ? (
              <Icon name="progress_activity" className="animate-spin text-xl text-primary" />
            ) : (
              <Icon name="upload_file" className="text-xl text-primary" />
            )}
            {jdExtracting ? 'Extracting…' : 'Upload JD (.pdf or .txt)'}
          </label>
          <span className="text-body-sm text-on-surface-variant">
            Extracts the text for you — nothing is stored.
          </span>
        </div>
        {jdNotice && (
          <p className="mt-3 rounded-lg bg-primary-container/40 p-3 text-body-sm text-on-surface">
            {jdNotice}
          </p>
        )}
        <label htmlFor="jd-paste" className="sr-only">
          Job description
        </label>
        <textarea
          id="jd-paste"
          rows={6}
          className="mt-3 w-full resize-y rounded-xl border border-outline-variant bg-white p-4 text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          placeholder="Paste the full job description…"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-body-sm text-on-surface-variant">
            {mode === 'voice'
              ? 'Voice mode · 2 credits'
              : mode === 'live'
                ? 'Live room · 3 credits'
                : 'Text mode · 1 credit'}
          </p>
          <Button
            variant="outline"
            onClick={() => void handleFromJd()}
            loading={loading}
            disabled={jdText.trim().length < 40}
            icon="auto_awesome"
          >
            Build my mock
          </Button>
        </div>
      </Card>

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
          <button
            type="button"
            onClick={() => setMode('voice')}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === 'voice'
                ? 'border-primary bg-primary-container/30'
                : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
            }`}
          >
            <span className="block font-bold text-on-surface">Voice</span>
            <span className="block text-body-sm text-on-surface-variant">
              Record your answer · 2 credits
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode('live')}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === 'live'
                ? 'border-primary bg-primary-container/30'
                : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
            }`}
          >
            <span className="block font-bold text-on-surface">Live room</span>
            <span className="block text-body-sm text-on-surface-variant">
              Real video interview with the AI · 3 credits
            </span>
          </button>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          size="lg"
          disabled={!packId || loading}
          loading={loading}
          onClick={() => void handleStart()}
          icon="play_arrow"
        >
          Continue to consent
        </Button>
      </div>
    </div>
  );
}
