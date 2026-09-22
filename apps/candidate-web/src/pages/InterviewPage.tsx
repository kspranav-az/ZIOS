import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { KitQuestion, TurnBody } from '@zios/shared-types';
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
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ prompt: string; answer: string | null }>>([]);
  const [initializing, setInitializing] = useState(true);
  const [recoveredFromStorage, setRecoveredFromStorage] = useState(false);
  const draftLoaded = useRef(false);
  const skipPersistRef = useRef(false);

  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [recoveredRecoveryToken, setRecoveredRecoveryToken] = useState<string | null>(null);

  const currentQuestion = useMemo<KitQuestion | undefined>(
    () => questions.find((q) => q.id === turn?.questionId),
    [questions, turn?.questionId],
  );
  const questionType = currentQuestion?.type ?? 'open_ended';

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
    if (questionType === 'open_ended' && !draftLoaded.current) {
      draftLoaded.current = true;
      const draft = loadAnswerDraft(sessionId);
      if (draft) {
        skipPersistRef.current = true;
      }
      setAnswer(draft);
    }
    recoverState().finally(() => setInitializing(false));
  }, [sessionId, recoveryToken, recoverState, questionType]);

  // Persist draft as the candidate types (text questions only).
  useEffect(() => {
    if (sessionId && draftLoaded.current && questionType === 'open_ended') {
      if (skipPersistRef.current) {
        skipPersistRef.current = false;
        return;
      }
      storeAnswerDraft(sessionId, answer);
    }
  }, [answer, sessionId, questionType]);

  // If the resolved turn is already wrapup, go to completion.
  useEffect(() => {
    if (turn?.type === 'wrapup') {
      navigate('/complete', { replace: true });
    }
  }, [turn, navigate]);

  // Reset structured answer state whenever the question changes.
  useEffect(() => {
    setSelectedOptionIds([]);
    setRating(null);
    if (questionType === 'open_ended') {
      setAnswer(sessionId ? loadAnswerDraft(sessionId) : '');
    } else {
      setAnswer('');
    }
  }, [turn?.questionId, questionType, sessionId]);

  if ((!sessionId || !recoveryToken) && recoveredFromStorage) {
    return (
      <ErrorState
        title="Session not found"
        message="We could not find your interview session. Please open the invite link again."
      />
    );
  }

  const buildTurnBody = (): TurnBody | null => {
    if (questionType === 'rating_scale') {
      if (rating === null) return null;
      return { answerData: { type: 'rating_scale', rating } };
    }
    if (questionType === 'mcq_single' || questionType === 'mcq_multi') {
      if (selectedOptionIds.length === 0) return null;
      return { answerData: { type: questionType, selectedOptionIds } };
    }
    const text = answer.trim();
    if (!text) return null;
    return { answer: text };
  };

  const isAnswerReady = (): boolean => {
    if (questionType === 'rating_scale') return rating !== null;
    if (questionType === 'mcq_single' || questionType === 'mcq_multi')
      return selectedOptionIds.length > 0;
    return answer.trim().length > 0;
  };

  const handleSubmit = async () => {
    if (!sessionId || !recoveryToken) return;
    const body = buildTurnBody();
    if (!body) return;

    setLoading(true);
    setError(null);
    try {
      const response = await submitTurn(sessionId, recoveryToken, body);
      setSession(response.session);
      if (turn) {
        setHistory((prev) => [
          ...prev,
          {
            prompt: turn.text,
            answer:
              questionType === 'rating_scale'
                ? `Rating: ${rating}/5`
                : questionType === 'mcq_single' || questionType === 'mcq_multi'
                  ? (currentQuestion?.options
                      ?.filter((o) => selectedOptionIds.includes(o.id))
                      .map((o) => o.text)
                      .join(', ') ?? '')
                  : answer.trim(),
          },
        ]);
      }
      setAnswer('');
      setSelectedOptionIds([]);
      setRating(null);
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

  const toggleOption = (optionId: string) => {
    if (questionType === 'mcq_single') {
      setSelectedOptionIds([optionId]);
      return;
    }
    setSelectedOptionIds((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
    );
  };

  const renderInput = () => {
    if (questionType === 'rating_scale') {
      return (
        <div className="flex flex-wrap items-center gap-3">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold transition-colors ${
                rating === value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
              aria-label={`Rate ${value} out of 5`}
            >
              {value}
            </button>
          ))}
        </div>
      );
    }

    if (questionType === 'mcq_single' || questionType === 'mcq_multi') {
      return (
        <div className="space-y-3">
          {(currentQuestion?.options ?? []).map((option) => {
            const selected = selectedOptionIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleOption(option.id)}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary-container/30'
                    : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    questionType === 'mcq_single' ? 'rounded-full' : 'rounded-md'
                  } ${selected ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant'}`}
                >
                  {selected && <Icon name="check" className="text-sm" />}
                </span>
                <span className="text-body-md text-on-surface">{option.text}</span>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <>
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
      </>
    );
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

          {renderInput()}

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
              disabled={!isAnswerReady()}
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
