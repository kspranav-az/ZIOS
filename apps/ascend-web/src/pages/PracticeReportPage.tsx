import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { EvidenceSpan, SessionTranscript } from '@zios/shared-types';
import { ApiErrorResponse, fetchPracticeReport, type PracticeReportDetail } from '../api';

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(100, Math.max(0, (score / 5) * 100))}%` }}
      />
    </div>
  );
}

/** Polling interval while the report is still being judged. */
const POLL_MS = 3000;

export function PracticeReportPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PracticeReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transcriptRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchPracticeReport(sessionId);
        if (cancelled) return;
        setDetail(result);
        // Judge still running (or tips still generating): poll briefly.
        if (!result.report || result.report.status === 'pending') {
          timer = setTimeout(() => void load(), POLL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiErrorResponse ? err.message : 'Could not load your report.');
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  /** Evidence spans grouped by transcript row for the replay panel. */
  const spansByTranscript = useMemo(() => {
    const map = new Map<string, EvidenceSpan[]>();
    for (const span of detail?.evidenceSpans ?? []) {
      if (!span.transcriptId) continue;
      const list = map.get(span.transcriptId) ?? [];
      list.push(span);
      map.set(span.transcriptId, list);
    }
    return map;
  }, [detail?.evidenceSpans]);

  const jumpToEvidence = (span: EvidenceSpan) => {
    if (!span.transcriptId) return;
    transcriptRefs.current.get(span.transcriptId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md pt-12 text-center">
        <h1 className="text-headline-sm text-on-surface">Report unavailable</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">{error}</p>
        <Button className="mt-6" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </div>
    );
  }

  if (!detail || !detail.report || detail.report.status === 'pending') {
    return (
      <div className="mx-auto w-full max-w-md pt-12 text-center">
        <Icon name="progress_activity" className="animate-spin text-4xl text-primary" />
        <h1 className="mt-4 text-headline-sm text-on-surface">Judging your mock…</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Your report and coaching tips are being generated. This usually takes under a minute.
        </p>
      </div>
    );
  }

  if (detail.report.status === 'failed') {
    return (
      <div className="mx-auto w-full max-w-md pt-12 text-center">
        <h1 className="text-headline-sm text-on-surface">Report failed</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          {detail.report.errorMessage ?? 'Something went wrong while judging this mock.'} Your
          credit was not refunded automatically — contact support.
        </p>
        <Button className="mt-6" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </div>
    );
  }

  const metrics = detail.report.communicationMetrics;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-sm text-on-surface">Your practice report</h1>
        <Button variant="outline" onClick={() => navigate('/practice')}>
          New mock
        </Button>
      </div>

      <Card padding="lg" radius="2xl">
        <div className="flex items-center gap-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary-container">
            <span className="text-headline-md text-on-primary">
              {detail.report.overallRecommendation ?? '—'}
            </span>
          </div>
          <div>
            <p className="text-label-bold uppercase tracking-wide text-on-surface-variant">
              Overall (1–5)
            </p>
            <p className="mt-1 text-body-md text-on-surface">
              {metrics.paceWpm > 0 ? `${metrics.paceWpm} words/min · ` : ''}
              {metrics.fillerCount} fillers · {metrics.paragraphCount} paragraphs
            </p>
          </div>
        </div>
      </Card>

      {detail.scores.length > 0 && (
        <Card padding="lg" radius="2xl">
          <h2 className="text-title-md text-on-surface">Scores by criterion</h2>
          <div className="mt-4 space-y-4">
            {detail.scores.map((score) => (
              <div key={score.id}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-body-md font-bold text-on-surface">{score.criterionText}</p>
                  <p className="text-label-bold text-on-surface-variant">
                    {score.score}/5 · weight {score.weight}
                  </p>
                </div>
                <ScoreBar score={score.score} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {detail.coachingTips.length > 0 && (
        <Card padding="lg" radius="2xl">
          <h2 className="text-title-md text-on-surface">Coach’s corner</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Tips grounded in your own answers — each one cites the moment it comes from.
          </p>
          <div className="mt-4 space-y-4">
            {detail.coachingTips.map((tip, index) => (
              <div key={index} className="rounded-xl bg-surface-container-low p-4">
                <p className="text-label-bold uppercase tracking-wide text-primary">
                  {tip.category}
                </p>
                <p className="mt-1 text-body-md text-on-surface">{tip.tip}</p>
                {tip.quoteText && (
                  <button
                    type="button"
                    onClick={() => {
                      const span = detail.evidenceSpans.find((s) => s.quoteText === tip.quoteText);
                      if (span) jumpToEvidence(span);
                    }}
                    className="mt-2 block w-full rounded-lg border-l-4 border-primary/40 bg-surface-container p-3 text-left text-body-sm italic text-on-surface-variant hover:bg-surface-container-high"
                  >
                    “{tip.quoteText}”
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padding="lg" radius="2xl">
        <h2 className="text-title-md text-on-surface">Replay</h2>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Your answers with the moments the judge cited. Tap a quote above to jump to it.
        </p>
        <div className="mt-4 space-y-3">
          {detail.transcript
            .filter((row: SessionTranscript) => row.answerText !== null)
            .map((row: SessionTranscript) => {
              // Several judge scores can cite the same moment (observed live: all
              // eight criteria quoting one identical answer rendered eight
              // duplicate chips). Show each distinct quote once per turn.
              const spans = (spansByTranscript.get(row.id) ?? []).filter(
                (span, idx, all) => all.findIndex((s) => s.quoteText === span.quoteText) === idx,
              );
              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) transcriptRefs.current.set(row.id, el);
                  }}
                  className="rounded-xl bg-surface-container-low p-4"
                >
                  <p className="text-label-bold uppercase tracking-wide text-on-surface-variant">
                    {row.questionPrompt}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-body-md text-on-surface">
                    {row.answerText}
                  </p>
                  {spans.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {spans.map((span) => (
                        <button
                          key={span.id}
                          type="button"
                          onClick={() => jumpToEvidence(span)}
                          className="block w-full rounded-lg border-l-4 border-primary/40 bg-surface-container p-2 text-left text-body-sm italic text-on-surface-variant hover:bg-surface-container-high"
                        >
                          “{span.quoteText}”
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}
