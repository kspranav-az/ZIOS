import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  CockpitStateResponse,
  EvaluationScore,
  ReportDetailResponse,
} from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { useToast } from '../../components/Toast';
import { userMessageForError } from '../../lib/errors';
import * as liveRoomsApi from '../../lib/live-rooms-api';
import { reportsApi } from '../../lib/reports-api';

/** /interviews/:sessionId/scorecard — human interviewer scorecard (Phase 09). */

type ScoreKey = `${string}:${string}`;

interface ScorecardState {
  cockpit: CockpitStateResponse | null;
  report: ReportDetailResponse | null;
  scores: Map<ScoreKey, number>;
  prefills: Map<ScoreKey, number>;
  loading: boolean;
  error?: string;
  submitting: boolean;
  prefilling: boolean;
}

export function ScorecardPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { push: showToast } = useToast();

  const [state, setState] = useState<ScorecardState>({
    cockpit: null,
    report: null,
    scores: new Map(),
    prefills: new Map(),
    loading: true,
    submitting: false,
    prefilling: false,
  });

  const setPartial = (patch: Partial<ScorecardState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  const applyScores = (
    scores: EvaluationScore[],
    currentScores: Map<ScoreKey, number>,
    currentPrefills: Map<ScoreKey, number>,
    target: 'scores' | 'prefills' | 'both' = 'scores',
  ) => {
    const nextScores = new Map(currentScores);
    const nextPrefills = new Map(currentPrefills);
    for (const score of scores) {
      const key: ScoreKey = `${score.questionId}:${score.criterionId}`;
      if (target === 'scores' || target === 'both') nextScores.set(key, score.score);
      if (target === 'prefills' || target === 'both') nextPrefills.set(key, score.score);
    }
    return { scores: nextScores, prefills: nextPrefills };
  };

  const load = useCallback(async () => {
    if (!sessionId) return;
    setPartial({ loading: true, error: undefined });
    try {
      const [cockpit, report] = await Promise.all([
        liveRoomsApi.getCockpitState(sessionId),
        reportsApi.getDetail(sessionId),
      ]);

      const initialScores = cockpit.scorecardPrefill ?? report.scores;
      const { scores, prefills } = applyScores(initialScores, new Map(), new Map(), 'both');

      setState({
        cockpit,
        report,
        scores,
        prefills,
        loading: false,
        submitting: false,
        prefilling: false,
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

  const editCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of state.scores.entries()) {
      if (state.prefills.get(key) !== value) {
        count += 1;
      }
    }
    return count;
  }, [state.scores, state.prefills]);

  const handlePrefill = async () => {
    if (!sessionId) return;
    setPartial({ prefilling: true });
    try {
      const detail = await liveRoomsApi.prefillScorecard(sessionId);
      const { scores, prefills } = applyScores(detail.scores, state.scores, state.prefills, 'both');
      setPartial({ report: detail, scores, prefills, prefilling: false });
      showToast('AI pre-fill generated', 'success');
    } catch (err) {
      showToast(userMessageForError(err), 'error');
      setPartial({ prefilling: false });
    }
  };

  const setScore = (questionId: string, criterionId: string, score: number) => {
    const key: ScoreKey = `${questionId}:${criterionId}`;
    setState((current) => {
      const next = new Map(current.scores);
      next.set(key, score);
      return { ...current, scores: next };
    });
  };

  const handleSubmit = async () => {
    if (!sessionId || !state.cockpit) return;

    const scores: Array<{
      questionId: string;
      criterionId: string;
      criterionText: string;
      score: number;
      weight: number;
    }> = [];

    for (const question of state.cockpit.kit.questions) {
      for (const criterion of question.rubricLines) {
        const key: ScoreKey = `${question.id}:${criterion.id}`;
        const score = state.scores.get(key);
        if (score === undefined) {
          showToast(`Score every criterion before submitting.`, 'error');
          return;
        }
        scores.push({
          questionId: question.id,
          criterionId: criterion.id,
          criterionText: criterion.text,
          score,
          weight: criterion.weight,
        });
      }
    }

    setPartial({ submitting: true });
    try {
      await liveRoomsApi.submitScorecard(sessionId, {
        scores,
        prefillAccepted: editCount === 0,
        editCount,
      });
      showToast('Scorecard submitted', 'success');
      navigate(`/interviews/${sessionId}`);
    } catch (err) {
      showToast(userMessageForError(err), 'error');
      setPartial({ submitting: false });
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

  if (state.error || !state.cockpit || !sessionId) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not load scorecard</p>
          <p className="text-sm text-on-surface-variant">{state.error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  const { cockpit, report } = state;
  const hasPrefill = report?.scores.some((s) => s.source === 'ai_prefill') ?? false;

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Scorecard
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            {cockpit.candidate.name} · {cockpit.kit.kit.title}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handlePrefill} loading={state.prefilling}>
            {hasPrefill ? 'Regenerate prefill' : 'Generate AI prefill'}
          </Button>
          <Button onClick={handleSubmit} loading={state.submitting}>
            Submit scorecard
          </Button>
        </div>
      </section>

      {editCount > 0 && (
        <Card className="mb-6 bg-secondary-container/20 border-secondary/30">
          <div className="flex items-center gap-3">
            <Icon name="edit" className="text-secondary" />
            <p className="text-sm text-on-surface-variant">
              <span className="font-label-bold text-primary">{editCount}</span> scores edited from
              the AI pre-fill.
            </p>
          </div>
        </Card>
      )}

      <div className="space-y-6">
        {cockpit.kit.questions.map((question) => (
          <Card key={question.id}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="font-label-bold text-primary">{question.prompt}</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {question.topic} · {question.difficulty}
                </p>
              </div>
              <Badge tone="secondary" className="text-[10px]">
                {question.rubricLines.length} criteria
              </Badge>
            </div>

            <div className="space-y-4">
              {question.rubricLines.map((criterion) => {
                const key: ScoreKey = `${question.id}:${criterion.id}`;
                const current = state.scores.get(key);
                const prefilled = state.prefills.get(key);
                return (
                  <div
                    key={criterion.id}
                    className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-surface-container-low rounded-xl p-4"
                  >
                    <div className="flex-1">
                      <p className="text-sm text-on-surface font-label-bold">{criterion.text}</p>
                      <p className="text-xs text-on-surface-variant mt-1">
                        Weight {Math.round(criterion.weight * 100)}%
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((value) => {
                        const isPrefill = prefilled === value && current === value;
                        const isSelected = current === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setScore(question.id, criterion.id, value)}
                            className={`w-10 h-10 rounded-xl font-label-bold transition-colors relative ${
                              isSelected
                                ? 'bg-primary text-on-primary'
                                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                            }`}
                            aria-label={`Score ${value}`}
                          >
                            {value}
                            {isPrefill && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-secondary rounded-full" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
