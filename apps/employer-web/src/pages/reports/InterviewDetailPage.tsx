import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  Candidate,
  EvaluationReport,
  EvaluationScore,
  EvidenceSpan,
  IntegrityFlag,
  ScoreOverride,
  SessionTranscript,
} from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { dashboardApi } from '../../lib/dashboard-api';
import { integrityApi } from '../../lib/integrity-api';
import { reportsApi } from '../../lib/reports-api';
import { userMessageForError } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import {
  evidenceForScore,
  formatDateTime,
  formatScore,
  metricsSummary,
  MODE_ICONS,
  overallRecommendationLabel,
  scoreForDisplay,
  SESSION_STATUS_LABELS,
  sessionStatusTone,
  sortTimelineStages,
  spansForQuestion,
} from './report-utils';
import { downloadReportPdf } from './report-pdf';

/** /interviews/:sessionId — evidence-linked report, transcript, overrides, PDF and share. */

interface DetailState {
  report: EvaluationReport;
  scores: EvaluationScore[];
  evidenceSpans: EvidenceSpan[];
  overrides: ScoreOverride[];
  transcript: SessionTranscript[];
  flags: IntegrityFlag[];
  candidate: Candidate;
  kitTitle: string;
  sessionStatus: import('@zios/shared-types').SessionStatus;
  sessionMode: import('@zios/shared-types').InterviewMode;
  sessionConductor: import('@zios/shared-types').SessionConductor;
}

export function InterviewDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { push: showToast } = useToast();
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string>();
  const [overrideScore, setOverrideScore] = useState<EvaluationScore | null>(null);
  const [dispositionFlag, setDispositionFlag] = useState<IntegrityFlag | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(undefined);
    try {
      const [detail, dashboard, flags] = await Promise.all([
        reportsApi.getDetail(sessionId),
        dashboardApi.listInterviews({ pageSize: 100 }),
        integrityApi.listFlags(sessionId),
      ]);
      const row = dashboard.items.find((item) => item.session.id === sessionId);
      if (!row) {
        throw new Error('Interview not found in dashboard');
      }
      setState({
        report: detail.report,
        scores: detail.scores,
        evidenceSpans: detail.evidenceSpans,
        overrides: detail.overrides,
        transcript: detail.transcript,
        flags: flags.flags,
        candidate: row.candidate,
        kitTitle: row.kitTitle,
        sessionStatus: row.session.status,
        sessionMode: row.session.mode,
        sessionConductor: row.session.conductor,
      });
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scoresByQuestion = useMemo(() => {
    const map = new Map<string, EvaluationScore[]>();
    for (const score of state?.scores ?? []) {
      const list = map.get(score.questionId) ?? [];
      list.push(score);
      map.set(score.questionId, list);
    }
    return map;
  }, [state?.scores]);

  const questionPrompts = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of state?.transcript ?? []) {
      if (!map.has(t.questionId)) {
        map.set(t.questionId, t.questionPrompt);
      }
    }
    return map;
  }, [state?.transcript]);

  const handleShare = async () => {
    if (!sessionId || !state) return;
    try {
      const { link } = await reportsApi.createShareLink(sessionId, { expiresInHours: 168 });
      const url = `${window.location.origin}/share/${encodeURIComponent(link.token)}`;
      setShareUrl(url);
      try {
        await navigator.clipboard?.writeText(url);
      } catch {
        // Clipboard may be unavailable in headless/embedded contexts; the link is still displayed.
      }
      showToast('Share link created', 'success');
    } catch (err) {
      showToast(userMessageForError(err), 'error');
    }
  };

  const handleDownloadPdf = () => {
    if (!state) return;
    downloadReportPdf({
      candidate: state.candidate,
      kitTitle: state.kitTitle,
      report: state.report,
      scores: state.scores,
      evidenceSpans: state.evidenceSpans,
      overrides: state.overrides,
      transcript: state.transcript,
    });
  };

  const scrollToSpan = (span: EvidenceSpan) => {
    const element = document.getElementById(`transcript-${span.transcriptId ?? span.questionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-2', 'ring-secondary', 'rounded-lg');
      window.setTimeout(
        () => element.classList.remove('ring-2', 'ring-secondary', 'rounded-lg'),
        1500,
      );
    }
  };

  if (loading) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 animate-pulse">
          <div className="h-8 w-1/3 bg-surface-container rounded mb-4" />
          <div className="h-32 w-full bg-surface-container rounded" />
        </Card>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not load report</p>
          <p className="text-sm text-on-surface-variant">{error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  const {
    report,
    evidenceSpans,
    overrides,
    transcript,
    flags,
    candidate,
    kitTitle,
    sessionStatus,
    sessionMode,
    sessionConductor,
  } = state;
  const timeline = sortTimelineStages(sessionStatus);
  const hasReport = report.status === 'completed';

  return (
    <div className="max-w-container-max mx-auto">
      {/* Header */}
      <section className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <Link
            to="/interviews"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2"
          >
            <Icon name="arrow_back" className="text-sm" /> Back to interviews
          </Link>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            {candidate.name}
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            {candidate.email} · {kitTitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {sessionConductor === 'human' && sessionStatus === 'completed' && !hasReport && (
            <Button
              variant="secondary"
              icon="assignment"
              onClick={() => navigate(`/interviews/${sessionId}/scorecard`)}
            >
              Score interview
            </Button>
          )}
          {sessionConductor === 'human' &&
            (sessionStatus === 'consented' ||
              sessionStatus === 'preflight' ||
              sessionStatus === 'live') && (
              <Button
                variant="secondary"
                icon="video_call"
                onClick={() => navigate(`/interviews/${sessionId}/cockpit`)}
              >
                Join cockpit
              </Button>
            )}
          <Button variant="outline" icon="share" onClick={handleShare}>
            Share
          </Button>
          <Button icon="download" onClick={handleDownloadPdf} disabled={!hasReport}>
            Download PDF
          </Button>
        </div>
      </section>

      {shareUrl && (
        <Card className="mb-6 bg-secondary-container/20 border-secondary/30">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Icon name="link" className="text-secondary text-xl" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface-variant">Public share link (7 days)</p>
              <p className="text-sm text-primary truncate font-mono">{shareUrl}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl);
                showToast('Copied', 'success');
              }}
            >
              Copy
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: timeline + candidate summary */}
        <div className="space-y-6">
          <Card>
            <h3 className="font-headline-sm text-headline-sm text-primary mb-4">
              Candidate timeline
            </h3>
            <div className="relative pl-4">
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-surface-variant" />
              {timeline.map((stage, index) => (
                <div key={stage.label} className="relative flex items-start gap-3 mb-4 last:mb-0">
                  <div
                    className={`z-10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      stage.status === 'done'
                        ? 'bg-primary text-on-primary'
                        : stage.status === 'active'
                          ? 'bg-secondary text-on-secondary'
                          : 'bg-surface-container-high text-outline'
                    }`}
                  >
                    {stage.status === 'done' ? (
                      <Icon name="check" className="text-xs" />
                    ) : (
                      <span className="text-xs">{index + 1}</span>
                    )}
                  </div>
                  <div>
                    <p className="font-label-bold text-sm text-primary">{stage.label}</p>
                    <p className="text-xs text-on-surface-variant">
                      {stage.status === 'active'
                        ? 'Current stage'
                        : stage.status === 'done'
                          ? 'Completed'
                          : 'Pending'}
                    </p>
                  </div>
                </div>
              ))}
              {hasReport && (
                <div className="relative flex items-start gap-3 mt-4">
                  <div className="z-10 w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0">
                    <Icon name="check" className="text-xs" />
                  </div>
                  <div>
                    <p className="font-label-bold text-sm text-primary">Report</p>
                    <p className="text-xs text-on-surface-variant">
                      Scored {formatDateTime(report.completedAt)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h3 className="font-headline-sm text-headline-sm text-primary mb-3">
              Interview details
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Mode</dt>
                <dd className="flex items-center gap-1 text-primary font-label-bold capitalize">
                  <Icon name={MODE_ICONS[sessionMode] ?? 'chat'} className="text-sm" />{' '}
                  {sessionMode}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Status</dt>
                <dd>
                  <Badge tone={sessionStatusTone(sessionStatus)}>
                    {SESSION_STATUS_LABELS[sessionStatus]}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Started</dt>
                <dd className="text-on-surface">{formatDateTime(report.startedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-on-surface-variant">Completed</dt>
                <dd className="text-on-surface">{formatDateTime(report.completedAt)}</dd>
              </div>
            </dl>
          </Card>
        </div>

        {/* Right: report */}
        <div className="lg:col-span-2 space-y-6">
          {!hasReport ? (
            <Card className="p-12 flex flex-col items-center text-center gap-3">
              <Icon name="hourglass_empty" className="text-4xl text-outline" />
              <p className="font-label-bold text-label-bold text-primary">Report not ready</p>
              <p className="text-sm text-on-surface-variant">
                This interview is still being scored. Check back in a few moments.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-on-surface-variant">Overall recommendation</p>
                    <div className="flex items-baseline gap-3 mt-1">
                      <h3 className="font-display-sm text-display-sm text-primary">
                        {overallRecommendationLabel(report.overallRecommendation)}
                      </h3>
                      <span className="text-headline-md font-headline-md text-primary">
                        {formatScore(report.overallRecommendation)}
                      </span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm text-on-surface-variant">Confidence</p>
                    <p className="text-headline-md font-headline-md text-primary">
                      {formatScore(report.overallConfidence)}
                    </p>
                  </div>
                </div>
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
                            const display = scoreForDisplay(score, overrides);
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
                                      <button
                                        key={span.id}
                                        type="button"
                                        onClick={() => scrollToSpan(span)}
                                        className="text-left text-xs bg-secondary-container/40 text-on-surface px-2.5 py-1.5 rounded-lg hover:bg-secondary-container transition-colors"
                                      >
                                        &ldquo;{span.quoteText.slice(0, 120)}
                                        {span.quoteText.length > 120 ? '…' : ''}&rdquo;
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-right">
                                    <p className="font-headline-sm text-headline-sm text-primary">
                                      {display.value}
                                      <span className="text-xs text-on-surface-variant">/5</span>
                                    </p>
                                    {display.isOverridden && (
                                      <p className="text-xs text-secondary font-label-bold">
                                        Overridden
                                      </p>
                                    )}
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setOverrideScore(score)}
                                  >
                                    Override
                                  </Button>
                                </div>
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
                <div ref={transcriptRef} className="space-y-4">
                  {transcript.map((t) => {
                    const spans = spansForQuestion(t.questionId, evidenceSpans);
                    return (
                      <div
                        key={t.id}
                        id={`transcript-${t.id}`}
                        className="p-3 rounded-xl bg-surface-container-low"
                      >
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

              {sessionMode === 'video' && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-headline-sm text-headline-sm text-primary">
                      Integrity flags
                    </h3>
                    <span className="text-xs text-on-surface-variant">
                      {flags.filter((f) => f.disposition === 'pending').length} pending
                    </span>
                  </div>
                  {flags.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">No integrity flags recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {flags.map((flag) => (
                        <div
                          key={flag.id}
                          className="rounded-xl border border-surface-variant/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-label-bold text-on-surface capitalize">
                                {flag.signal.replace(/_/g, ' ')}
                              </p>
                              <p className="text-xs text-on-surface-variant">
                                {formatDateTime(flag.occurredAt)}
                              </p>
                            </div>
                            <Badge
                              tone={
                                flag.disposition === 'confirmed'
                                  ? 'error'
                                  : flag.disposition === 'dismissed'
                                    ? 'success'
                                    : 'warning'
                              }
                              className="text-[10px] capitalize"
                            >
                              {flag.disposition}
                            </Badge>
                          </div>
                          <div className="mt-2 text-xs text-on-surface-variant">
                            {flag.evidence && Object.keys(flag.evidence).length > 0 && (
                              <details>
                                <summary className="cursor-pointer">Evidence</summary>
                                <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface-container-low p-2">
                                  {JSON.stringify(flag.evidence, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                          {flag.disposition === 'pending' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => setDispositionFlag(flag)}
                            >
                              Disposition
                            </Button>
                          )}
                          {flag.disposition !== 'pending' && flag.dispositionedBy && (
                            <p className="mt-2 text-xs text-on-surface-variant">
                              Dispositioned as {flag.disposition} · {flag.dispositionReasonCode}
                              {flag.dispositionReasonText ? ` · ${flag.dispositionReasonText}` : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {overrideScore && (
        <OverrideModal
          score={overrideScore}
          sessionId={sessionId!}
          onClose={() => setOverrideScore(null)}
          onOverride={load}
        />
      )}

      {dispositionFlag && (
        <DispositionModal
          flag={dispositionFlag}
          sessionId={sessionId!}
          onClose={() => setDispositionFlag(null)}
          onDisposition={load}
        />
      )}
    </div>
  );
}

interface OverrideModalProps {
  score: EvaluationScore;
  sessionId: string;
  onClose: () => void;
  onOverride: () => void | Promise<void>;
}

function OverrideModal({ score, sessionId, onClose, onOverride }: OverrideModalProps) {
  const { push: showToast } = useToast();
  const [newScore, setNewScore] = useState<number>(score.score);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await reportsApi.overrideScore(sessionId, score.id, {
        newScore,
        reasonCode: reasonCode.trim(),
        reasonText: reasonText.trim() || undefined,
      });
      showToast('Score overridden', 'success');
      onClose();
      await onOverride();
    } catch (err) {
      showToast(userMessageForError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-surface-container-lowest rounded-3xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-headline-sm text-headline-sm text-primary mb-1">Override score</h3>
        <p className="text-sm text-on-surface-variant mb-4">
          {score.criterionText} — current score {score.score}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-bold text-primary block mb-2">New score</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewScore(value)}
                  className={`w-10 h-10 rounded-xl font-label-bold transition-colors ${
                    newScore === value
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="reasonCode" className="text-sm font-bold text-primary block mb-1.5">
              Reason code <span className="text-error">*</span>
            </label>
            <input
              id="reasonCode"
              required
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="e.g. EVIDENCE_MISSED"
              className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/10 outline-none"
            />
          </div>
          <div>
            <label htmlFor="reasonText" className="text-sm font-bold text-primary block mb-1.5">
              Notes
            </label>
            <textarea
              id="reasonText"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="Optional context for the override"
              className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/10 outline-none resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" type="button" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="flex-1">
              Save override
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
interface DispositionModalProps {
  flag: IntegrityFlag;
  sessionId: string;
  onClose: () => void;
  onDisposition: () => void | Promise<void>;
}

const REASON_CODES = [
  { value: 'false_positive', label: 'False positive' },
  { value: 'technical_issue', label: 'Technical issue' },
  { value: 'candidate_explained', label: 'Candidate explained' },
  { value: 'confirmed_violation', label: 'Confirmed violation' },
  { value: 'other', label: 'Other' },
];

function DispositionModal({ flag, sessionId, onClose, onDisposition }: DispositionModalProps) {
  const { push: showToast } = useToast();
  const [disposition, setDisposition] = useState<'dismissed' | 'confirmed'>('dismissed');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reasonCode.trim()) return;
    setSubmitting(true);
    try {
      await integrityApi.dispositionFlag(sessionId, flag.id, {
        disposition,
        reasonCode: reasonCode.trim() as 'false_positive',
        reasonText: reasonText.trim() || undefined,
      });
      showToast('Flag dispositioned', 'success');
      onClose();
      await onDisposition();
    } catch (err) {
      showToast(userMessageForError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-surface-container-lowest rounded-3xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-headline-sm text-headline-sm text-primary mb-1">Disposition flag</h3>
        <p className="text-sm text-on-surface-variant mb-4 capitalize">
          {flag.signal.replace(/_/g, ' ')}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-bold text-primary block mb-2">Decision</label>
            <div className="flex gap-2">
              {[
                { value: 'dismissed', label: 'Dismiss' },
                { value: 'confirmed', label: 'Confirm' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDisposition(option.value as 'dismissed' | 'confirmed')}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-label-bold transition-colors ${
                    disposition === option.value
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="reasonCode" className="text-sm font-bold text-primary block mb-1.5">
              Reason code <span className="text-error">*</span>
            </label>
            <select
              id="reasonCode"
              required
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/10 outline-none"
            >
              <option value="">Select a reason</option>
              {REASON_CODES.map((code) => (
                <option key={code.value} value={code.value}>
                  {code.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reasonText" className="text-sm font-bold text-primary block mb-1.5">
              Notes
            </label>
            <textarea
              id="reasonText"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="Optional context for the disposition"
              className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary/10 outline-none resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" type="button" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="flex-1">
              Save disposition
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
