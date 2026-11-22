import { useEffect, useMemo, useState } from 'react';
import { Card, Icon } from '@zios/ui';
import type { DashboardAnalyticsResponse } from '@zios/shared-types';
import { dashboardApi } from '../../lib/dashboard-api';

/**
 * Analytics — KPI grid, hiring funnel and interview volume, wired to
 * GET /dashboard/analytics?days=N. Charts are dependency-free CSS bars
 * (the design reference used recharts; bars keep the bundle lean and the
 * visual language identical).
 */

const TIMEFRAMES = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
] as const;

const FUNNEL_STEPS: Array<{ key: keyof DashboardAnalyticsResponse['pipeline']; label: string }> = [
  { key: 'sourced', label: 'Sourced' },
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'AI Screening' },
  { key: 'technical', label: 'Technical' },
  { key: 'final', label: 'Final' },
  { key: 'offers', label: 'Offers' },
];

export function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState('30');
  const [data, setData] = useState<DashboardAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    dashboardApi
      .getAnalytics(Number(timeframe))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics');
      });
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  const kpis = data
    ? [
        { id: 'candidates', icon: 'group', iconBg: 'bg-primary/10', iconColor: 'text-primary', label: 'Total Candidates', value: data.kpis.totalCandidates },
        { id: 'jobs', icon: 'work', iconBg: 'bg-secondary/10', iconColor: 'text-secondary', label: 'Active Jobs', value: data.kpis.activeJobs },
        { id: 'scheduled', icon: 'calendar_today', iconBg: 'bg-primary-container/10', iconColor: 'text-primary-container', label: `Scheduled (${data.days}d)`, value: data.kpis.scheduled },
        { id: 'completed', icon: 'check_circle', iconBg: 'bg-tertiary/10', iconColor: 'text-tertiary', label: `Completed (${data.days}d)`, value: data.kpis.completed },
        { id: 'reviews', icon: 'star', iconBg: 'bg-primary/10', iconColor: 'text-primary', label: 'Pending Score Reviews', value: data.kpis.pendingReviews },
        { id: 'live', icon: 'videocam', iconBg: 'bg-success/10', iconColor: 'text-success', label: 'Live Now', value: data.kpis.liveNow },
      ]
    : null;

  const funnelMax = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, ...FUNNEL_STEPS.map((s) => data.pipeline[s.key]));
  }, [data]);

  const volumeMax = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.volume.map((v) => Math.max(v.created, v.completed)));
  }, [data]);

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Analytics
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Hiring performance across your pipeline
          </p>
        </div>
        <select
          aria-label="Timeframe"
          className="bg-surface-container-low border-none rounded-lg text-xs font-label-bold text-primary pr-8 py-2 outline-none self-start md:self-auto"
          value={timeframe}
          onChange={(event) => setTimeframe(event.target.value)}
        >
          {TIMEFRAMES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      {error && (
        <p className="mb-6 rounded-xl bg-error/5 px-4 py-3 text-sm text-error">{error}</p>
      )}

      {/* KPI grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {(kpis ?? []).map((kpi) => (
          <Card key={kpi.id}>
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 ${kpi.iconBg} rounded-lg`}>
                <Icon name={kpi.icon} className={kpi.iconColor} />
              </div>
            </div>
            <p className="text-on-surface-variant text-sm font-label-bold uppercase tracking-wider">
              {kpi.label}
            </p>
            <h3 className="text-headline-md font-headline-md text-primary mt-1.5">{kpi.value}</h3>
          </Card>
        ))}
      </section>

      {/* Funnel + volume panels */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card radius="2xl" padding="lg">
          <h4 className="font-headline-sm text-headline-sm text-primary mb-2">Hiring Funnel</h4>
          <p className="text-sm text-on-surface-variant mb-6">
            Conversion from applicants to hires (all time)
          </p>
          {!data ? (
            <EmptyChart icon="filter_list" message="Loading…" />
          ) : data.pipeline.sourced === 0 ? (
            <EmptyChart
              icon="filter_list"
              message="Funnel data appears once candidates flow through your pipeline."
            />
          ) : (
            <div className="space-y-3">
              {FUNNEL_STEPS.map((step) => {
                const value = data.pipeline[step.key];
                const pct = Math.max(2, Math.round((value / funnelMax) * 100));
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-label-bold text-on-surface-variant">
                      {step.label}
                    </span>
                    <div className="h-6 flex-1 rounded-lg bg-surface-container-low overflow-hidden">
                      <div
                        className="h-full rounded-lg bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-sm font-bold text-on-surface">
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card radius="2xl" padding="lg">
          <h4 className="font-headline-sm text-headline-sm text-primary mb-2">Interview Volume</h4>
          <p className="text-sm text-on-surface-variant mb-6">
            Scheduled vs completed interviews per day
          </p>
          {!data ? (
            <EmptyChart icon="bar_chart" message="Loading…" />
          ) : data.volume.every((v) => v.created === 0 && v.completed === 0) ? (
            <EmptyChart
              icon="bar_chart"
              message="Volume trends appear after your first interviews."
            />
          ) : (
            <div>
              <div className="flex h-48 items-end gap-1">
                {data.volume.map((v) => (
                  <div
                    key={v.day}
                    className="flex flex-1 flex-col justify-end gap-0.5"
                    title={`${v.day} — ${v.created} scheduled, ${v.completed} completed`}
                  >
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(v.created > 0 ? 4 : 0, (v.created / volumeMax) * 100)}%` }}
                    />
                    <div
                      className="w-full rounded-t bg-tertiary/70"
                      style={{ height: `${Math.max(v.completed > 0 ? 4 : 0, (v.completed / volumeMax) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-on-surface-variant">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Scheduled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-tertiary/70" /> Completed
                </span>
              </div>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function EmptyChart({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="h-48 rounded-2xl bg-surface-container-low flex flex-col items-center justify-center text-center gap-3 p-6">
      <Icon name={icon} className="text-3xl text-outline" />
      <p className="text-sm text-on-surface-variant">{message}</p>
    </div>
  );
}
