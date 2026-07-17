import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { reportsApi } from '../../lib/reports-api';
import { ApiRequestError } from '../../lib/api';
import {
  evidenceForScore,
  formatDateTime,
  formatScore,
  metricsSummary,
  overallRecommendationLabel,
  scoreForDisplay,
  spansForQuestion,
} from './report-utils';
import { downloadReportPdf } from './report-pdf';

/** /share/:token — public read-only report view (Phase 04). */

export function ShareReportPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof reportsApi.getShared>> | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('Invalid share link');
      setLoading(false);
      return;
    }
    reportsApi
      .getShared(token)
      .then((response) => setData(response))
      .catch((err) => {
        if (err instanceof ApiRequestError && err.statusCode === 404) {
          setError('This share link is invalid or has expired.');
        } else if (err instanceof ApiRequestError) {
          setError(err.message || 'Could not load the shared report.');
        } else {
          setError('Could not load the shared report.');
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const scoresByQuestion = useMemo(() => {
    const map = new Map<string, import('@zios/shared-types').EvaluationScore[]>();
    for (const score of data?.scores ?? []) {
      const list = map.get(score.questionId) ?? [];
      list.push(score);
      map.set(score.questionId, list);
    }
    return map;
  }, [data?.scores]);

  const questionPrompts = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.transcript ?? []) {
      if (!map.has(t.questionId)) {
        map.set(t.questionId, t.questionPrompt);
      }
    }
    return map;
  }, [data?.transcript]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="link_off" className="text-2xl text-error" />
          </div>
          <h1 className="font-headline-md text-headline-md text-primary">Link unavailable</h1>
          <p className="text-sm text-on-surface-variant">{error}</p>
        </Card>
      </div>
    );
  }

  if (!data) return null;
  const { report, scores, evidenceSpans, transcript } = data;
  const hasReport = report.status === 'completed';

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-surface-variant/50 bg-surface-container-lowest">
        <div className="max-w-container-max mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon name="assignment" className="text-primary text-2xl" />
            <h1 className="font-headline-sm text-headline-sm text-primary">
              Shared interview report
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="download"
            onClick={() =>
              downloadReportPdf({
                candidate: {
                  name: 'Candidate',
                  email: '',
                  id: '',
                  orgId: '',
                  phone: null,
                  externalRef: null,
                  piiVaultRef: null,
                  createdAt: '',
                },
                kitTitle: 'Shared report',
                report,
                scores,
                evidenceSpans,
                overrides: [],
                transcript,
              })
            }
            disabled={!hasReport}
          >
            Download PDF
          </Button>
        </div>
      </header>

      <main className="max-w-container-max mx-auto px-4 sm:px-8 py-8 space-y-6">
        {!hasReport ? (
          <Card className="p-12 flex flex-col items-center text-center gap-3">
            <Icon name="hourglass_empty" className="text-4xl text-outline" />
            <p className="font-label-bold text-label-bold text-primary">Report not ready</p>
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-sm text-on-surface-variant">Overall recommendation</p>
              <div className="flex items-baseline gap-3 mt-1">
                <h2 className="font-display-sm text-display-sm text-primary">
                  {overallRecommendationLabel(report.overallRecommendation)}
                </h2>
                <span className="text-headline-md font-headline-md text-primary">
                  {formatScore(report.overallRecommendation)}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mt-2">
                Confidence {formatScore(report.overallConfidence)} · Completed{' '}
                {formatDateTime(report.completedAt)}
              </p>
            </Card>

            <Card>
              <h3 className="font-headline-sm text-headline-sm text-primary mb-3">
                Communication metrics
              </h3>
              <p className="text-on-surface">{metricsSummary(report.communicationMetrics)}</p>
            </Card>

            <Card>
              <h3 className="font-headline-sm text-headline-sm text-primary mb-4">
                Per-question scores
              </h3>
              <div className="space-y-6">
                {Array.from(scoresByQuestion.entries()).map(([questionId, questionScores]) => {
                  const prompt = questionPrompts.get(questionId) ?? 'Question';
                  return (
                    <div
                      key={questionId}
                      className="border border-surface-variant/50 rounded-2xl p-4"
                    >
                      <p className="font-label-bold text-primary mb-3">{prompt}</p>
                      <div className="space-y-3">
                        {questionScores.map((score) => {
                          const display = scoreForDisplay(score, []);
                          const evidence = evidenceForScore(score, evidenceSpans);
                          return (
                            <div
                              key={score.id}
                              className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-surface-container-low rounded-xl p-3"
                            >
                              <div className="flex-1">
                                <p className="text-sm text-on-surface font-label-bold">
                                  {score.criterionText}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {evidence.map((span) => (
                                    <span
                                      key={span.id}
                                      className="text-xs bg-secondary-container/40 text-on-surface px-2.5 py-1.5 rounded-lg"
                                    >
                                      &ldquo;{span.quoteText.slice(0, 120)}
                                      {span.quoteText.length > 120 ? '…' : ''}&rdquo;
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <p className="font-headline-sm text-headline-sm text-primary shrink-0">
                                {display.value}
                                <span className="text-xs text-on-surface-variant">/5</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="font-headline-sm text-headline-sm text-primary mb-4">Transcript</h3>
              <div className="space-y-4">
                {transcript.map((t) => {
                  const spans = spansForQuestion(t.questionId, evidenceSpans);
                  return (
                    <div key={t.id} className="p-3 rounded-xl bg-surface-container-low">
                      <p className="text-sm font-label-bold text-primary mb-1">
                        {t.questionPrompt}
                      </p>
                      <p className="text-sm text-on-surface whitespace-pre-wrap">
                        {t.answerText ?? (
                          <span className="italic text-on-surface-variant">No answer</span>
                        )}
                      </p>
                      {spans.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {spans.map((span) => (
                            <Badge key={span.id} tone="secondary" className="text-[10px]">
                              Evidence
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
