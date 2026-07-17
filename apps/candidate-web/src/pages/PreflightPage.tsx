import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import { ApiErrorResponse, startPreflight } from '../api';
import { useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

export function PreflightPage() {
  const navigate = useNavigate();
  const { session, recoveryToken, setResolvedData } = useInterview();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || !recoveryToken) {
    return (
      <ErrorState
        title="Session not ready"
        message="Your interview session could not be found. Please open the invite link again."
      />
    );
  }

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await startPreflight(session.id, recoveryToken, {
        report: { source: 'candidate-web', ready: true },
      });
      setResolvedData({ session: response.session, turn: response.turn });
      navigate('/interview', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not start the interview. Please try again.',
      );
      setLoading(false);
    }
  };

  if (loading) return <LoadingState message="Starting your interview…" />;

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-xl">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container">
              <Icon name="checklist" className="text-2xl text-on-primary" />
            </div>
            <div>
              <h1 className="text-headline-sm text-on-surface">Ready to start?</h1>
              <p className="text-body-md text-on-surface-variant">
                A quiet place and a stable connection will help you do your best.
              </p>
            </div>
          </div>

          <ul className="mt-6 space-y-3 text-body-md text-on-surface-variant">
            <li className="flex items-start gap-3">
              <Icon name="timer" className="mt-0.5 text-primary-container" />
              <span>You can take your time on each question. The timer is a soft guide.</span>
            </li>
            <li className="flex items-start gap-3">
              <Icon name="edit" className="mt-0.5 text-primary-container" />
              <span>Type your answers in the text box. You can edit before submitting.</span>
            </li>
            <li className="flex items-start gap-3">
              <Icon name="save" className="mt-0.5 text-primary-container" />
              <span>
                Your current draft is saved locally. If you reload, pick up where you left off.
              </span>
            </li>
          </ul>

          {error && (
            <p className="mt-6 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <Button className="mt-8 w-full" size="lg" onClick={handleStart} loading={loading}>
            Start interview
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}
