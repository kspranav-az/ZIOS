import { useState } from 'react';
import { Card, Icon } from '@zios/ui';

/**
 * Analytics — structure ported from the reference's
 * pages/Recruiter/Analytics.jsx (header + timeframe select, KPI grid,
 * funnel and volume panels). Charts (recharts in the reference) arrive with
 * the evaluation phase; panels render empty states until then.
 */

const TIMEFRAMES = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
];

const KPIS = [
  {
    id: 'candidates',
    icon: 'group',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    label: 'Total Candidates',
  },
  {
    id: 'jobs',
    icon: 'work',
    iconBg: 'bg-secondary/10',
    iconColor: 'text-secondary',
    label: 'Active Jobs',
  },
  {
    id: 'scheduled',
    icon: 'calendar_today',
    iconBg: 'bg-primary-container/10',
    iconColor: 'text-primary-container',
    label: 'Scheduled Interviews',
  },
  {
    id: 'completed',
    icon: 'check_circle',
    iconBg: 'bg-tertiary/10',
    iconColor: 'text-tertiary',
    label: 'Completed Interviews',
  },
  {
    id: 'shortlisted',
    icon: 'star',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    label: 'Shortlisted',
  },
  {
    id: 'hired',
    icon: 'verified',
    iconBg: 'bg-secondary/10',
    iconColor: 'text-secondary',
    label: 'Hired',
  },
] as const;

export function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState('30');

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

      {/* KPI grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {KPIS.map((kpi) => (
          <Card key={kpi.id}>
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 ${kpi.iconBg} rounded-lg`}>
                <Icon name={kpi.icon} className={kpi.iconColor} />
              </div>
            </div>
            <p className="text-on-surface-variant text-sm font-label-bold uppercase tracking-wider">
              {kpi.label}
            </p>
            <h3 className="text-headline-md font-headline-md text-primary mt-1.5">0</h3>
          </Card>
        ))}
      </section>

      {/* Funnel + volume panels */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card radius="2xl" padding="lg">
          <h4 className="font-headline-sm text-headline-sm text-primary mb-2">Hiring Funnel</h4>
          <p className="text-sm text-on-surface-variant mb-6">
            Conversion from applicants to hires
          </p>
          <EmptyChart
            icon="filter_list"
            message="Funnel data appears once candidates flow through your pipeline."
          />
        </Card>
        <Card radius="2xl" padding="lg">
          <h4 className="font-headline-sm text-headline-sm text-primary mb-2">Interview Volume</h4>
          <p className="text-sm text-on-surface-variant mb-6">
            Scheduled vs completed interviews over time
          </p>
          <EmptyChart
            icon="bar_chart"
            message="Volume trends appear after your first interviews."
          />
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
