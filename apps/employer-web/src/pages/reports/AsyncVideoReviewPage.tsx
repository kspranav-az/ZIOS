import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import { useToast } from '../../components/Toast';
import { userMessageForError } from '../../lib/errors';
import {
  AsyncVideoAnswer,
  AsyncVideoReviewQuestion,
  AsyncVideoReviewScore,
  getAsyncVideoReview,
  submitAsyncVideoScore,
} from '../../lib/async-video-api';

interface ReviewState {
  candidateName: string;
  candidateEmail: string;
  questions: AsyncVideoReviewQuestion[];
  answers: AsyncVideoAnswer[];
  scores: Map<string, AsyncVideoReviewScore>;
  loading: boolean;
  error?: string;
}

function getVideoUri(answer: AsyncVideoAnswer): string | null {
  const data = answer.answerData;
  if (!data) return null;
  const video = data.videoAnswer;
  if (video && typeof video.recordingUri === 'string') return video.recordingUri;
  return null;
}

function getTranscript(answer: AsyncVideoAnswer): string | null {
  const data = answer.answerData;
  if (!data) return null;
  const video = data.videoAnswer;
  if (video && typeof video.transcript === 'string') return video.transcript;
  if (typeof answer.answerText === 'string' && answer.answerText.length > 0) {
    return answer.answerText;
  }
  return null;
}

export function AsyncVideoReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { push: showToast } = useToast();

  const [state, setState] = useState<ReviewState>({
    candidateName: '',
    candidateEmail: '',
    questions: [],
    answers: [],
    scores: new Map(),
    loading: true,
  });

  const setPartial = (patch: Partial<ReviewState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  const load = useCallback(async () => {
    if (!sessionId) return;
    setPartial({ loading: true, error: undefined });
    try {
      const detail = await getAsyncVideoReview(sessionId);
      const scoreMap = new Map<string, AsyncVideoReviewScore>();
      for (const score of detail.scores) {
        scoreMap.set(score.questionId, score);
      }
      setState({
        candidateName: detail.candidate.name,
        candidateEmail: detail.candidate.email,
        questions: detail.questions,
        answers: detail.answers,
        scores: scoreMap,
        loading: false,
      });
    } catch (err) {
      setState((current) => ({
        ...current,
        loading: false,
        error: userMessageForError(err),
      }));
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleScoreChange = (questionId: string, score: number | undefined) => {
    setState((current) => {
      const next = new Map(current.scores);
      const existing = next.get(questionId);
      next.set(questionId, {
        ...(existing ?? {
          id: '',
          sessionId: sessionId ?? '',
          questionId,
          score: null,
          remarks: null,
          reviewedBy: null,
          createdAt: '',
          updatedAt: '',
        }),
        score: score ?? null,
      });
      return { ...current, scores: next };
    });
  };

  const handleRemarksChange = (questionId: string, remarks: string) => {
    setState((current) => {
      const next = new Map(current.scores);
      const existing = next.get(questionId);
      next.set(questionId, {
        ...(existing ?? {
          id: '',
          sessionId: sessionId ?? '',
          questionId,
          score: null,
          remarks: null,
          reviewedBy: null,
          createdAt: '',
          updatedAt: '',
        }),
        remarks: remarks.trim() || null,
      });
      return { ...current, scores: next };
    });
  };

  const handleSubmit = async (questionId: string) => {
    if (!sessionId) return;
    const scoreRecord = state.scores.get(questionId);
    try {
      const saved = await submitAsyncVideoScore(sessionId, questionId, {
        score: scoreRecord?.score ?? undefined,
        remarks: scoreRecord?.remarks ?? undefined,
      });
      setState((current) => {
        const next = new Map(current.scores);
        next.set(questionId, saved);
        return { ...current, scores: next };
      });
      showToast('Score saved', 'success');
    } catch (err) {
      showToast(userMessageForError(err), 'error');
    }
  };

  if (state.loading) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 animate-pulse">
          <div className="h-8 w-1/3 bg-surface-container rounded mb-4" />
          <div className="h-64 w-full bg-surface-container rounded" />
        </Card>
      </div>
    );
  }

  if (state.error || !sessionId) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not load review</p>
          <p className="text-sm text-on-surface-variant">{state.error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Async video review
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            {state.candidateName} · {state.candidateEmail}
          </p>
        </div>
      </section>

      <div className="space-y-6">
        {state.questions.map((question) => {
          const answer = state.answers.find((a) => a.questionId === question.id);
          const videoUri = answer ? getVideoUri(answer) : null;
          const transcript = answer ? getTranscript(answer) : null;
          const scoreRecord = state.scores.get(question.id);
          const currentScore = scoreRecord?.score ?? undefined;
          const currentRemarks = scoreRecord?.remarks ?? '';

          return (
            <Card key={question.id}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="font-label-bold text-primary">{question.prompt}</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {question.topic} · {question.difficulty}
                  </p>
                </div>
              </div>

              {videoUri ? (
                <div className="mb-4 rounded-xl overflow-hidden bg-surface-container-low">
                  <video
                    src={videoUri}
                    controls
                    className="aspect-video w-full object-cover"
                    preload="metadata"
                  />
                </div>
              ) : (
                <div className="mb-4 rounded-xl bg-surface-container-low p-8 text-center">
                  <Icon name="videocam_off" className="text-3xl text-on-surface-variant" />
                  <p className="mt-2 text-body-md text-on-surface-variant">No video answer yet</p>
                </div>
              )}

              {transcript && (
                <div className="mb-4 rounded-xl bg-surface-container-low p-4">
                  <p className="text-label-bold text-on-surface-variant">Transcript</p>
                  <p className="mt-1 text-body-md text-on-surface">{transcript}</p>
                </div>
              )}

              <div className="bg-surface-container-low rounded-xl p-4 space-y-4">
                <div>
                  <p className="text-sm text-on-surface font-label-bold mb-2">Score</p>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleScoreChange(question.id, value)}
                        className={`w-10 h-10 rounded-xl font-label-bold transition-colors ${
                          currentScore === value
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                        }`}
                        aria-label={`Score ${value}`}
                      >
                        {value}
                      </button>
                    ))}
                    {currentScore === undefined && (
                      <span className="text-xs text-on-surface-variant ml-2">Unscored</span>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={`remarks-${question.id}`}
                    className="text-sm text-on-surface font-label-bold"
                  >
                    Remarks
                  </label>
                  <textarea
                    id={`remarks-${question.id}`}
                    value={currentRemarks}
                    onChange={(e) => handleRemarksChange(question.id, e.target.value)}
                    placeholder="Add your notes about this answer…"
                    className="mt-2 w-full rounded-xl border border-outline bg-surface p-3 text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => handleSubmit(question.id)}>Save score</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
