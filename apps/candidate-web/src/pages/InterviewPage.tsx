import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import { ApiErrorResponse, submitTurn } from '../api';
import {
  loadAnswerDraft,
  loadRecovery,
  loadStoredSessionId,
  storeAnswerDraft,
  useInterview,
} from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

export function InterviewPage() {
  const navigate = useNavigate();
  const {
    session: contextSession,
    recoveryToken: contextRecoveryToken,
    turn,
    questions,
    setResolvedData,
    setSession,
  } = useInterview();
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ prompt: string; answer: string | null }>>([]);
  const [initializing, setInitializing] = useState(true);
  const [recoveredFromStorage, setRecoveredFromStorage] = useState(false);
  const draftLoaded = useRef(false);

  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [recoveredRecoveryToken, setRecoveredRecoveryToken] = useState<string | null>(null);

  // Recover session context from sessionStorage when the page is reloaded directly.
  useEffect(() => {
    if (contextSession && contextRecoveryToken) return;
    const storedSessionId = loadStoredSessionId();
    const storedRecoveryToken = storedSessionId ? loadRecovery(storedSessionId) : null;
    if (storedSessionId && storedRecoveryToken) {
      setRecoveredSessionId(storedSessionId);
      setRecoveredRecoveryToken(storedRecoveryToken);
    }
    setRecoveredFromStorage(true);
  }, [contextSession, contextRecoveryToken]);

  const session = contextSession;
  const recoveryToken = contextRecoveryToken ?? recoveredRecoveryToken;
  const sessionId = session?.id ?? recoveredSessionId;

  const recoverState = useCallback(async () => {
    if (!sessionId || !recoveryToken) return;
    try {
      // Ask the conductor for the current (or next) turn without submitting an answer.
      const turnResponse = await submitTurn(sessionId, recoveryToken, {});
      setSession(turnResponse.session);
      setResolvedData({ turn: turnResponse.turn });
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not recover your session. Please try again.',
      );
    }
  }, [sessionId, recoveryToken, setSession, setResolvedData]);

  // Load draft and recover session state on mount.
  useEffect(() => {
    if (!sessionId || !recoveryToken) {
      setInitializing(false);
      return;
    }
    if (!draftLoaded.current) {
      draftLoaded.current = true;
      setAnswer(loadAnswerDraft(sessionId));
    }
    recoverState().finally(() => setInitializing(false));
  }, [sessionId, recoveryToken, recoverState]);

  // Persist draft as the candidate types.
  useEffect(() => {
    if (sessionId && draftLoaded.current) {
      storeAnswerDraft(sessionId, answer);
    }
  }, [answer, sessionId]);

  // If the resolved turn is already wrapup, go to completion.
  useEffect(() => {
    if (turn?.type === 'wrapup') {
      navigate('/complete', { replace: true });
    }
  }, [turn, navigate]);

  if ((!sessionId || !recoveryToken) && recoveredFromStorage) {
    return (
      <ErrorState
        title="Session not found"
        message="We could not find your interview session. Please open the invite link again."
      />
    );
  }

  const handleSubmit = async () => {
    if (!answer.trim() || !sessionId || !recoveryToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await submitTurn(sessionId, recoveryToken, { answer: answer.trim() });
      setSession(response.session);
      if (turn) {
        setHistory((prev) => [...prev, { prompt: turn.text, answer: answer.trim() }]);
      }
      setAnswer('');
      if (response.turn.type === 'wrapup') {
        navigate('/complete', { replace: true });
      } else {
        setResolvedData({ turn: response.turn });
      }
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not submit your answer. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (initializing) return <LoadingState message="Recovering your interview…" />;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Interview in progress</h1>
          <span className="rounded-full bg-surface-container px-3 py-1 text-label-bold text-on-surface-variant">
            {history.length + 1} of {questions.length > 0 ? questions.length : '—'}
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

        <Card padding="lg" radius="2xl">
          {turn && (
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
          )}

          <label htmlFor="answer" className="sr-only">
            Your answer
          </label>
          <textarea
            id="answer"
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
              onClick={handleSubmit}
              loading={loading}
              disabled={!answer.trim()}
              icon="send"
            >
              Submit answer
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
