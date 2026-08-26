import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { KitQuestion } from '@zios/shared-types';
import {
  ApiErrorResponse,
  getAsyncVideoQuestions,
  uploadAsyncVideoAnswer,
  type AsyncVideoAnswer,
} from '../api';
import { loadRecovery, loadStoredSessionId, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';
import { VideoRecorder, type RecorderState } from '../components/VideoRecorder';

export function AsyncVideoInterviewPage() {
  const navigate = useNavigate();
  const { session: contextSession, recoveryToken: contextRecoveryToken } = useInterview();
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [recoveredRecoveryToken, setRecoveredRecoveryToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<KitQuestion[]>([]);
  const [answers, setAnswers] = useState<AsyncVideoAnswer[]>([]);
  const [maxDurationSec, setMaxDurationSec] = useState(180);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [finishOpen, setFinishOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const session = contextSession;
  const recoveryToken = contextRecoveryToken ?? recoveredRecoveryToken;
  const sessionId = session?.id ?? recoveredSessionId;

  useEffect(() => {
    if (contextSession && contextRecoveryToken) return;
    const storedSessionId = loadStoredSessionId();
    const storedRecoveryToken = storedSessionId ? loadRecovery(storedSessionId) : null;
    if (storedSessionId && storedRecoveryToken) {
      setRecoveredSessionId(storedSessionId);
      setRecoveredRecoveryToken(storedRecoveryToken);
    }
  }, [contextSession, contextRecoveryToken]);

  const loadQuestions = useCallback(
    async (preserveActive = false) => {
      if (!sessionId || !recoveryToken) return;
      try {
        setLoading(true);
        const data = await getAsyncVideoQuestions(sessionId, recoveryToken);

        if (data.session.status === 'completed') {
          navigate('/complete', { replace: true });
          return;
        }

        setQuestions(data.questions);
        setAnswers(data.answers);
        setMaxDurationSec(data.maxDurationSec);
        if (!preserveActive) {
          const firstPending = data.answers.findIndex((a) => a.answerData === null);
          setActiveIndex(firstPending === -1 ? 0 : firstPending);
        }
      } catch (err) {
        if (err instanceof ApiErrorResponse && err.code === 'SESSION_COMPLETED') {
          navigate('/complete', { replace: true });
          return;
        }
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not load your interview. Please try again.',
        );
      } finally {
        setLoading(false);
      }
    },
    [sessionId, recoveryToken, navigate],
  );

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  const handleSubmit = async (blob: Blob, durationSec: number) => {
    const question = questions[activeIndex];
    if (!question || !sessionId || !recoveryToken) return;
    console.log('[async-video] submitting answer', {
      sessionId,
      questionId: question.id,
      activeIndex,
      totalQuestions: questions.length,
    });
    setUploadingQuestionId(question.id);
    try {
      const result = await uploadAsyncVideoAnswer(
        sessionId,
        question.id,
        recoveryToken,
        blob,
        durationSec,
      );
      console.log('[async-video] upload result', {
        completed: result.completed,
        answeredCount: answers.filter((a) => a.answerData !== null).length,
        totalQuestions: questions.length,
      });
      await loadQuestions(true);

      if (result.completed) {
        setFinishOpen(true);
        setToast({
          message: 'All answers submitted. You can now finish the interview.',
          tone: 'success',
        });
      } else if (activeIndex < questions.length - 1) {
        setActiveIndex((prev) => prev + 1);
        setToast({
          message: `Answer ${activeIndex + 1} of ${questions.length} saved. Moving to question ${activeIndex + 2}.`,
          tone: 'success',
        });
      } else {
        setToast({
          message: `Answer ${activeIndex + 1} of ${questions.length} saved.`,
          tone: 'success',
        });
      }
    } catch (err) {
      console.error('[async-video] upload failed', err);
      setToast({
        message: err instanceof ApiErrorResponse ? err.message : 'Upload failed. Please try again.',
        tone: 'error',
      });
      throw err;
    } finally {
      setUploadingQuestionId(null);
      window.setTimeout(() => setToast(null), 4000);
    }
  };

  const hasUnsubmittedRecording = recorderState === 'review' || recorderState === 'uploading';
  const isBusy =
    recorderState === 'requesting' ||
    recorderState === 'recording' ||
    recorderState === 'uploading';

  if (!sessionId || !recoveryToken) {
    return (
      <ErrorState
        title="Session not found"
        message="We could not find your interview session. Please open the invite link again."
      />
    );
  }

  if (loading) return <LoadingState message="Loading your interview…" />;
  if (error) {
    return (
      <ErrorState
        title="Something went wrong"
        message={error}
        onRetry={() => {
          setError(null);
          void loadQuestions();
        }}
      />
    );
  }

  const activeQuestion = questions[activeIndex];
  const answeredCount = answers.filter((a) => a.answerData !== null).length;
  const progress = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  const allAnswered = answeredCount === questions.length && questions.length > 0;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-headline-sm text-on-surface">Async video interview</h1>
            <p className="text-body-md text-on-surface-variant">
              Question {activeIndex + 1} of {questions.length}
            </p>
          </div>
          <div className="text-right">
            <p className="text-label-bold text-on-surface-variant">
              {answeredCount}/{questions.length} answered
            </p>
            <div className="mt-1 h-2 w-32 overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {(finishOpen || allAnswered) && (
          <Card padding="lg" radius="2xl" className="mb-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Icon name="check_circle" className="text-xl text-on-primary" />
              </div>
              <div>
                <h2 className="text-headline-sm text-on-surface">All answers submitted</h2>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  You have answered every question. Click below to finish the interview.
                </p>
                <Button className="mt-4" onClick={() => navigate('/complete', { replace: true })}>
                  Finish interview
                </Button>
              </div>
            </div>
          </Card>
        )}

        {toast && (
          <div
            className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-3 text-body-md shadow-lg ${
              toast.tone === 'success'
                ? 'bg-primary-container text-on-primary-container'
                : 'bg-error-container text-on-error-container'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}

        {activeQuestion && !finishOpen ? (
          <Card padding="lg" radius="2xl">
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Icon name="help_outline" className="text-xl text-on-primary" />
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                  {activeQuestion.topic}
                </p>
                <p className="mt-1 text-body-lg text-on-surface">{activeQuestion.prompt}</p>
                <p className="mt-2 text-body-sm text-on-surface-variant">
                  Max {maxDurationSec} seconds per answer
                </p>
              </div>
            </div>

            <VideoRecorder
              key={activeQuestion.id}
              maxDurationSec={maxDurationSec}
              onSubmit={handleSubmit}
              onStateChange={setRecorderState}
              disabled={uploadingQuestionId === activeQuestion.id}
            />

            {hasUnsubmittedRecording && (
              <p className="mt-4 rounded-lg bg-warning-container p-3 text-body-md text-on-warning-container">
                <Icon name="warning" className="mr-2 inline text-lg" />
                Submit this answer before moving to another question.
              </p>
            )}

            <div className="mt-6 flex justify-between">
              <Button
                variant="outline"
                onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                disabled={activeIndex === 0 || isBusy || hasUnsubmittedRecording}
                icon="arrow_back"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setActiveIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                disabled={activeIndex === questions.length - 1 || isBusy || hasUnsubmittedRecording}
                icon="arrow_forward"
              >
                Next
              </Button>
            </div>

            <div className="mt-6 border-t border-outline pt-4">
              <p className="text-label-bold text-on-surface-variant mb-2">Question overview</p>
              <div className="flex flex-wrap gap-2">
                {questions.map((q, idx) => {
                  const answered = answers[idx]?.answerData !== null;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        if (!hasUnsubmittedRecording) setActiveIndex(idx);
                      }}
                      disabled={hasUnsubmittedRecording}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-label-bold transition-colors ${
                        answered
                          ? 'bg-primary text-on-primary'
                          : isActive
                            ? 'bg-primary-container text-on-primary-container ring-2 ring-primary'
                            : 'bg-surface-container text-on-surface-variant'
                      } ${hasUnsubmittedRecording ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-container-high'}`}
                      aria-label={`Question ${idx + 1}${answered ? ' answered' : ''}`}
                    >
                      {answered ? <Icon name="check" className="text-sm" /> : idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        ) : (
          !finishOpen && (
            <Card padding="lg" radius="2xl">
              <p className="text-body-lg text-on-surface">No questions available.</p>
            </Card>
          )
        )}
      </div>
    </PageShell>
  );
}
