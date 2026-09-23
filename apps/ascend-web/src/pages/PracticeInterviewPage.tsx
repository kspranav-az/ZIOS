import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { SessionTurnResponse } from '@zios/shared-types';
import {
  ApiErrorResponse,
  clearPracticeRecovery,
  fetchPracticeSession,
  loadPracticeRecovery,
  preflightPractice,
  submitPracticeTurn,
} from '../api';
import { PageShell } from '../components/PageShell';

interface HistoryItem {
  prompt: string;
  answer: string | null;
}

/**
 * Text-mode practice mock (D5). Mirrors candidate-web's InterviewPage flow:
 * preflight → question/follow-up loop → wrapup → report. The recovery token
 * is tab-scoped in sessionStorage (D12) so a refresh can resume the mock.
 */
export function PracticeInterviewPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [turn, setTurn] = useState<SessionTurnResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recoveryToken = loadPracticeRecovery(sessionId);

  const recover = useCallback(async () => {
    if (!recoveryToken) return;
    try {
      const [preflight, detail] = await Promise.all([
        preflightPractice(sessionId, recoveryToken),
        fetchPracticeSession(sessionId),
      ]);
      setTotalQuestions(detail.questions.length);
      if (preflight.session.status === 'completed') {
        navigate(`/practice/${sessionId}/report`, { replace: true });
        return;
      }
      setTurn(preflight.turn);
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not resume your mock. Please start a new one.',
      );
    }
  }, [sessionId, recoveryToken, navigate]);

  useEffect(() => {
    if (!recoveryToken) {
      setInitializing(false);
      return;
    }
    recover().finally(() => setInitializing(false));
  }, [recover, recoveryToken]);

  const handleSubmit = async () => {
    if (!recoveryToken) return;
    const text = answer.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const response = await submitPracticeTurn(sessionId, recoveryToken, { answer: text });
      if (turn) {
        setHistory((prev) => [...prev, { prompt: turn.text, answer: text }]);
      }
      setAnswer('');
      if (response.turn.type === 'wrapup') {
        clearPracticeRecovery(sessionId);
        navigate(`/practice/${sessionId}/report`, { replace: true });
      } else {
        setTurn(response.turn);
      }
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse ? err.message : 'Could not submit your answer. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (!recoveryToken) {
    return (
      <PageShell>
        <div className="mx-auto w-full max-w-md pt-12 text-center">
          <h1 className="text-headline-sm text-on-surface">Mock not found</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            We could not find this practice session in this tab. Start a new mock from the home
            page.
          </p>
          <Button className="mt-6" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </div>
      </PageShell>
    );
  }

  if (initializing) {
    return (
      <PageShell>
        <p className="mx-auto pt-12 text-body-md text-on-surface-variant">Preparing your mock…</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Practice mock</h1>
          <span className="rounded-full bg-surface-container px-3 py-1 text-label-bold text-on-surface-variant">
            {history.length + 1}
            {totalQuestions > 0 ? ` of ~${totalQuestions}` : ''}
          </span>
        </div>

        {history.length > 0 && (
          <div className="mb-6 space-y-3">
            {history.map((item, index) => (
              <Card key={index} padding="md" radius="xl" className="bg-surface-container-low">
                <p className="font-bold text-on-surface">{item.prompt}</p>
                {item.answer && (
                  <p className="mt-2 whitespace-pre-wrap text-body-md text-on-surface-variant">
                    {item.answer}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

        {turn && (
          <Card padding="lg" radius="2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Icon name="smart_toy" className="text-xl text-on-primary" />
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                  {turn.type === 'followup' ? 'Follow-up' : 'Question'}
                </p>
                <p className="mt-1 text-body-lg text-on-surface">{turn.text}</p>
              </div>
            </div>

            <label htmlFor="practice-answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="practice-answer"
              rows={6}
              className="w-full resize-y rounded-xl border border-outline-variant bg-white p-4 text-body-md text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="Type your answer here…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={loading}
            />

            {error && (
              <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                size="lg"
                onClick={() => void handleSubmit()}
                loading={loading}
                disabled={answer.trim().length === 0}
                icon="send"
              >
                Submit answer
              </Button>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
