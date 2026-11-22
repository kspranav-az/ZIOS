import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { DashboardSummaryResponse } from '@zios/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { InviteDialog } from './InviteDialog';
import { dashboardApi } from '../../lib/dashboard-api';
import { SESSION_STATUS_LABELS, formatDate } from '../reports/report-utils';

/**
 * Dashboard — structure ported from the reference's
 * pages/Recruiter/Recruiterdashboard.jsx (welcome header, stat cards,
 * pipeline overview, upcoming interviews, quick actions). All numbers come
 * from GET /dashboard/summary; empty states render when the org has no data.
 */

const STAT_CARDS = [
  {
    id: 'candidates',
    icon: 'group',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    label: 'Total Candidates',
    barColor: 'bg-primary',
  },
  {
    id: 'jobs',
    icon: 'work',
    iconBg: 'bg-secondary/10',
    iconColor: 'text-secondary',
    label: 'Active Jobs',
    barColor: 'bg-secondary',
  },
  {
    id: 'interviews',
    icon: 'calendar_today',
    iconBg: 'bg-primary-container/10',
    iconColor: 'text-primary-container',
    label: 'Interviews',
    barColor: 'bg-primary-container',
  },
  {
    id: 'tth',
    icon: 'timer',
    iconBg: 'bg-tertiary/10',
    iconColor: 'text-tertiary',
    label: 'Time to Hire',
    barColor: 'bg-tertiary',
  },
] as const;

const PIPELINE_STAGES = [
  { id: 'sourced', label: 'Sourced', bg: 'bg-surface-container-low', inverse: false },
  { id: 'applied', label: 'Applied', bg: 'bg-surface-container-high', inverse: false },
  { id: 'screening', label: 'AI Screening', bg: 'bg-primary-container', inverse: true },
  { id: 'technical', label: 'Technical', bg: 'bg-surface-container-highest', inverse: false },
  { id: 'final', label: 'Final', bg: 'bg-surface-variant', inverse: false },
  { id: 'offers', label: 'Offers', bg: 'bg-secondary-container', inverse: true },
] as const;

const MODE_ICONS: Record<string, string> = {
  text: 'chat',
  voice: 'mic',
  video: 'videocam',
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .getSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // Summary failure is non-fatal — sections render their empty states.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = state.status === 'authenticated' ? state.user.name.split(' ')[0] : '';
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';
  const stats = summary?.stats;
  const pipeline = summary?.pipeline;
  const statValues: Record<(typeof STAT_CARDS)[number]['id'], string> = {
    candidates: String(stats?.totalCandidates ?? 0),
    jobs: String(stats?.activeJobs ?? 0),
    interviews: String(stats?.totalInterviews ?? 0),
    tth: summary?.timeToHireDays != null ? `${summary.timeToHireDays}d` : '—',
  };
  const pipelineValues: Record<(typeof PIPELINE_STAGES)[number]['id'], number> = {
    sourced: pipeline?.sourced ?? 0,
    applied: pipeline?.applied ?? 0,
    screening: pipeline?.screening ?? 0,
    technical: pipeline?.technical ?? 0,
    final: pipeline?.final ?? 0,
    offers: pipeline?.offers ?? 0,
  };
  const pipelineBase = Math.max(pipelineValues.sourced, 1);

  return (
    <div>
      {/* Header / welcome section */}
      <section className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            {greeting()}, {firstName}
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            You have {stats?.pendingReviews ?? 0} interview
            {(stats?.pendingReviews ?? 0) === 1 ? '' : 's'} pending score review and{' '}
            {stats?.liveNow ?? 0} in progress.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 self-start md:self-auto">
          <Button size="lg" icon="calendar_add_on" onClick={() => navigate('/interviews')}>
            Schedule Interview
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon="group"
            onClick={() => navigate('/candidates')}
          >
            View Candidates
          </Button>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {STAT_CARDS.map((stat) => (
          <Card key={stat.id}>
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 ${stat.iconBg} rounded-lg`}>
                <Icon name={stat.icon} className={stat.iconColor} />
              </div>
            </div>
            <p className="text-on-surface-variant text-sm font-label-bold uppercase tracking-wider">
              {stat.label}
            </p>
            <h3 className="text-headline-md font-headline-md text-primary mt-1.5">
              {statValues[stat.id]}
            </h3>
            <div className="mt-4 h-1 w-full bg-surface-container rounded-full overflow-hidden">
              <div
                className={`h-full ${stat.barColor}`}
                style={{ width: `${stat.id === 'tth' ? 0 : Math.min(100, (Number(statValues[stat.id]) / pipelineBase) * 100)}%` }}
              />
            </div>
          </Card>
        ))}
      </section>

      {/* Pipeline overview */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h4 className="font-headline-sm text-headline-sm text-primary">
            Candidate Pipeline Overview
          </h4>
          <button
            type="button"
            onClick={() => navigate('/candidates')}
            className="text-primary font-label-bold text-sm flex items-center gap-1 hover:underline"
          >
            View Full Pipeline <Icon name="arrow_forward" className="text-sm" />
          </button>
        </div>
        <div className="bg-white p-2 rounded-2xl shadow-sm overflow-x-auto flex items-center min-w-max">
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage.id}
              className={`flex-1 min-w-[180px] p-6 text-center relative rounded-xl mx-2 first:ml-0 last:mr-0 ${stage.bg}`}
            >
              <span
                className={`text-2xl font-bold ${stage.inverse ? 'text-on-primary' : 'text-primary'}`}
              >
                {pipelineValues[stage.id]}
              </span>
              <p
                className={`text-xs font-label-bold uppercase mt-1 ${
                  stage.inverse ? 'text-on-primary opacity-80' : 'text-on-surface-variant'
                }`}
              >
                {stage.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming interviews + quick actions */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card padding="none" radius="2xl" className="lg:col-span-2 overflow-hidden">
          <div className="p-6 border-b border-surface-variant/50 flex justify-between items-center">
            <h4 className="font-headline-sm text-headline-sm text-primary">Upcoming Interviews</h4>
            <span className="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-label-bold">
              {(summary?.awaiting.length ?? 0)} Awaiting candidate
            </span>
          </div>
          {summary && summary.awaiting.length > 0 ? (
            <ul className="divide-y divide-surface-variant/50">
              {summary.awaiting.map((item) => (
                <li key={item.sessionId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/interviews/${item.sessionId}`)}
                    className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-surface-container-low transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container/20">
                      <Icon
                        name={MODE_ICONS[item.mode] ?? 'chat'}
                        className="text-primary-container"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-label-bold text-primary truncate">
                        {item.candidateName}
                      </p>
                      <p className="text-sm text-on-surface-variant">
                        {SESSION_STATUS_LABELS[item.status]} · invited{' '}
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <Icon name="chevron_right" className="text-outline" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-12 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                <Icon name="event_available" className="text-2xl text-outline" />
              </div>
              <div>
                <p className="font-label-bold text-label-bold text-primary">
                  No interviews awaiting candidates
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  Nothing in progress right now. Schedule one to get started.
                </p>
              </div>
            </div>
          )}
        </Card>

        <div className="bg-primary text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-secondary opacity-10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
          <div>
            <h4 className="font-headline-sm text-headline-sm mb-6">Quick Actions</h4>
            <div className="space-y-4">
              <QuickAction
                icon="verified_user"
                iconColor="text-primary-fixed"
                label="Review AI Scores"
                onClick={() => navigate('/candidates')}
              />
              <QuickAction
                icon="summarize"
                iconColor="text-surface-container"
                label="View Analytics"
                onClick={() => navigate('/analytics')}
              />
              {isAdmin && (
                <QuickAction
                  icon="person_add"
                  iconColor="text-secondary-fixed"
                  label="Invite Team Member"
                  onClick={() => setInviteOpen(true)}
                />
              )}
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-4">
            <div className="p-3 bg-secondary/20 rounded-lg">
              <Icon name="auto_awesome" className="text-secondary" />
            </div>
            <div>
              <p className="text-xs font-label-bold text-white/70 uppercase">AI Recommendation</p>
              <p className="text-sm">
                AI matching insights appear once your first interviews complete.
              </p>
            </div>
          </div>
        </div>
      </section>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function QuickAction({
  icon,
  iconColor,
  label,
  onClick,
}: {
  icon: string;
  iconColor: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-between px-6 transition-all group/btn"
    >
      <div className="flex items-center gap-3">
        <Icon name={icon} className={iconColor} />
        <span className="font-label-bold">{label}</span>
      </div>
      <Icon
        name="chevron_right"
        className="text-sm group-hover/btn:translate-x-1 transition-transform"
      />
    </button>
  );
}
