import { Card, Icon } from '@zios/ui';

/**
 * Interviews — structure ported from the reference's
 * pages/Recruiter/Upcominginterviews.jsx (header, KPI stat cards, today's
 * list, activity feed). Scheduling lands with the interviews phase; both
 * sections render their empty states until then.
 */

const STATS = [
  {
    id: 'today',
    icon: 'today',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    label: "Today's Interviews",
    barColor: 'bg-primary',
  },
  {
    id: 'week',
    icon: 'date_range',
    iconBg: 'bg-secondary/10',
    iconColor: 'text-secondary',
    label: 'This Week',
    barColor: 'bg-secondary',
  },
  {
    id: 'completed',
    icon: 'check_circle',
    iconBg: 'bg-primary-container/10',
    iconColor: 'text-primary-container',
    label: 'Completed',
    barColor: 'bg-primary-container',
  },
  {
    id: 'cancelled',
    icon: 'cancel',
    iconBg: 'bg-error/10',
    iconColor: 'text-error',
    label: 'Cancelled',
    barColor: 'bg-error',
  },
] as const;

export function InterviewsPage() {
  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Interviews
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Manage and track all your scheduled interviews
          </p>
        </div>
      </section>

      {/* KPI stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {STATS.map((stat) => (
          <Card key={stat.id}>
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 ${stat.iconBg} rounded-lg`}>
                <Icon name={stat.icon} className={stat.iconColor} />
              </div>
            </div>
            <p className="text-on-surface-variant text-sm font-label-bold uppercase tracking-wider">
              {stat.label}
            </p>
            <h3 className="text-headline-md font-headline-md text-primary mt-1">0</h3>
            <div className="mt-4 h-1 w-full bg-surface-container rounded-full overflow-hidden">
              <div className={`h-full ${stat.barColor}`} style={{ width: '0%' }} />
            </div>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Today's interviews */}
        <Card padding="none" radius="2xl" className="lg:col-span-2 overflow-hidden">
          <div className="p-6 border-b border-surface-variant/50 flex justify-between items-center">
            <h4 className="font-headline-sm text-headline-sm text-primary">
              Today&apos;s Interviews
            </h4>
            <span className="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-label-bold">
              0 Today
            </span>
          </div>
          <div className="p-12 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
              <Icon name="event_available" className="text-2xl text-outline" />
            </div>
            <div>
              <p className="font-label-bold text-label-bold text-primary">No interviews today</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Nothing on the calendar for today yet. Schedule one to get started.
              </p>
            </div>
          </div>
        </Card>

        {/* Activity feed */}
        <Card padding="none" radius="2xl" className="overflow-hidden">
          <div className="p-6 border-b border-surface-variant/50">
            <h4 className="font-headline-sm text-headline-sm text-primary">Recent Activity</h4>
          </div>
          <div className="p-12 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
              <Icon name="history" className="text-2xl text-outline" />
            </div>
            <div>
              <p className="font-label-bold text-label-bold text-primary">No activity yet</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Interview events will show up here as they happen.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
