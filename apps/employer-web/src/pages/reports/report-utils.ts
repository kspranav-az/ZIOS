import type {
  CommunicationMetrics,
  DashboardInterviewItem,
  EvaluationScore,
  EvidenceSpan,
  ScoreOverride,
  SessionStatus,
} from '@zios/shared-types';

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  invited: 'Invited',
  consented: 'Consented',
  preflight: 'Preflight',
  live: 'Live',
  completed: 'Completed',
  abandoned: 'Abandoned',
  scoring: 'Scoring',
  reported: 'Reported',
  reviewed: 'Reviewed',
};

export const MODE_ICONS: Record<string, string> = {
  text: 'chat',
  voice: 'mic',
  video: 'videocam',
};

export function sessionStatusTone(
  status: SessionStatus,
): 'warning' | 'success' | 'error' | 'neutral' {
  switch (status) {
    case 'completed':
    case 'reported':
    case 'reviewed':
      return 'success';
    case 'abandoned':
      return 'error';
    case 'invited':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function reportStatusTone(
  status: string | null,
): 'warning' | 'success' | 'error' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(1);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

export function overallRecommendationLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'No recommendation';
  if (value >= 4.5) return 'Strong hire';
  if (value >= 3.5) return 'Hire';
  if (value >= 2.5) return 'Lean hire';
  if (value >= 1.5) return 'Lean no-hire';
  return 'No-hire';
}

export function scoreForDisplay(
  score: EvaluationScore,
  overrides: ScoreOverride[],
): { value: number; isOverridden: boolean; override?: ScoreOverride } {
  const override = overrides.find((o) => o.scoreId === score.id);
  if (override) return { value: override.newScore, isOverridden: true, override };
  return { value: score.score, isOverridden: false };
}

export function evidenceForScore(
  score: EvaluationScore,
  evidenceSpans: EvidenceSpan[],
): EvidenceSpan[] {
  return evidenceSpans.filter((span) => score.evidenceSpanIds.includes(span.id));
}

export function spansForQuestion(
  questionId: string,
  evidenceSpans: EvidenceSpan[],
): EvidenceSpan[] {
  return evidenceSpans.filter((span) => span.questionId === questionId);
}

export function metricsSummary(metrics: CommunicationMetrics): string {
  const parts = [
    `${Math.round(metrics.paceWpm)} WPM`,
    `${metrics.fillerCount} filler${metrics.fillerCount === 1 ? '' : 's'}`,
    `${metrics.paragraphCount} paragraph${metrics.paragraphCount === 1 ? '' : 's'}`,
    `${metrics.avgSentenceLength.toFixed(1)} words/sentence`,
  ];
  return parts.join(' · ');
}

export function sortTimelineStages(currentStatus: SessionStatus): {
  label: string;
  status: 'done' | 'active' | 'pending';
}[] {
  const stages: SessionStatus[] = ['invited', 'consented', 'preflight', 'live', 'completed'];
  const currentIndex = stages.indexOf(currentStatus);

  return stages.map((stage, index) => {
    if (stage === currentStatus)
      return { label: SESSION_STATUS_LABELS[stage], status: 'active' as const };
    if (currentIndex !== -1 && index < currentIndex)
      return { label: SESSION_STATUS_LABELS[stage], status: 'done' as const };
    return { label: SESSION_STATUS_LABELS[stage], status: 'pending' as const };
  });
}

export function dashboardRowOverall(item: DashboardInterviewItem): {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
} {
  if (item.reportStatus === 'failed') {
    return { label: 'Evaluation failed', value: '—', tone: 'error' };
  }
  if (item.reportStatus === 'pending') {
    return { label: 'Scoring in progress', value: '…', tone: 'warning' };
  }
  if (item.overallRecommendation !== null) {
    const label = overallRecommendationLabel(item.overallRecommendation);
    const tone =
      item.overallRecommendation >= 3.5
        ? 'success'
        : item.overallRecommendation >= 2.5
          ? 'warning'
          : 'error';
    return { label, value: item.overallRecommendation.toFixed(1), tone };
  }
  return { label: 'No score', value: '—', tone: 'neutral' };
}
