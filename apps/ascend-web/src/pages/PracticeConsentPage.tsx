import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Card } from '@zios/ui';
import { ApiErrorResponse, consentPractice, fetchPracticeLibrary } from '../api';
import { PageShell } from '../components/PageShell';

interface ConsentState {
  consent?: { version: string; text: string };
}

/** X8 consent gate: no capture before a stored consent artifact. */
export function PracticeConsentPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as ConsentState;
  const [consent, setConsent] = useState(state.consent ?? null);
  const [recordingAllowed, setRecordingAllowed] = useState(false);
  const [modelOptIn, setModelOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Direct landing (refresh): fetch the canonical consent text from the API.
  useEffect(() => {
    if (consent) return;
    let cancelled = false;
    fetchPracticeLibrary()
      .then((library) => {
        if (!cancelled) setConsent(library.consent);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the consent text. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [consent]);

  const handleConsent = async () => {
    setLoading(true);
    setError(null);
    try {
      await consentPractice(sessionId, { recordingAllowed, modelOptIn });
      navigate(`/practice/${sessionId}/interview`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiErrorResponse ? err.message : 'Could not store consent. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-headline-sm text-on-surface">Before we start</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          This mock interview records your answers so an AI coach can score them and give you
          feedback. Nothing is captured before you consent.
        </p>

        {consent && (
          <Card padding="md" radius="xl" className="mt-6 max-h-72 overflow-y-auto bg-surface-container-low">
            <p className="whitespace-pre-wrap text-body-md text-on-surface-variant">{consent.text}</p>
            <p className="mt-3 text-label-sm text-on-surface-variant/70">Version: {consent.version}</p>
          </Card>
        )}

        <div className="mt-6 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={recordingAllowed}
              onChange={(e) => setRecordingAllowed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
              data-testid="consent-recording"
            />
            <span className="text-body-md text-on-surface">
              I consent to my answers being recorded and processed to generate my practice report.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={modelOptIn}
              onChange={(e) => setModelOptIn(e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="text-body-md text-on-surface-variant">
              Optional: allow my anonymised answers to improve the coaching model.
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate('/practice')}>
            Back
          </Button>
          <Button size="lg" disabled={!recordingAllowed || loading} loading={loading} onClick={() => void handleConsent()}>
            I consent — start the mock
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
