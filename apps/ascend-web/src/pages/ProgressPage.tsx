import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '@zios/ui';
import { ApiErrorResponse, fetchProgress, type CandidateProgressResponse } from '../api';
import { PageShell } from '../components/PageShell';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Tiny inline SVG trend chart for the overall recommendation series. */
function TrendChart({ points }: { points: Array<{ completedAt: string; overallRecommendation: number | null }> }) {
  const scored = points.filter((p) => p.overallRecommendation !== null);
  if (scored.length === 0) return null;
  const W = 320;
  const H = 96;
  const PAD = 8;
  const min = 0;
  const max = 5;
  const x = (i: number) =>
    scored.length === 1 ? W / 2 : PAD + (i / (scored.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const path = scored
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.overallRecommendation as number).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="Score trend">
      <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} className="stroke-outline-variant" strokeWidth="1" />
      <line x1={PAD} y1={y(5)} x2={W - PAD} y2={y(5)} className="stroke-outline-variant" strokeWidth="1" />
      <path d={path} fill="none" className="stroke-primary" strokeWidth="2" />
      {scored.map((p, i) => (
        <circle
          key={p.completedAt}
          cx={x(i)}
          cy={y(p.overallRecommendation as number)}
          r="3.5"
          className="fill-primary"
        />
      ))}
    </svg>
  );
}

export function ProgressPage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<CandidateProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgress()
      .then(setProgress)
      .catch((err: unknown) => {
        if (err instanceof ApiErrorResponse && err.statusCode === 401) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load your progress.');
      });
  }, []);

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col py-8">
        <h1 className="text-headline-sm text-on-surface">Progress</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Mocks completed, score trend, and your daily streak.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        {progress && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <Card padding="lg" radius="2xl">
                <p className="text-body-md text-on-surface-variant">Mocks completed</p>
                <p className="mt-1 text-headline-md text-on-surface">
                  {progress.trends.length}
                  <span className="text-body-md text-on-surface-variant">
                    {' '}
                    / {progress.dailyCap} today
                  </span>
                </p>
              </Card>
              <Card padding="lg" radius="2xl">
                <p className="text-body-md text-on-surface-variant">Streak</p>
                <p className="mt-1 text-headline-md text-on-surface">
                  {progress.streak.current}
                  <span className="text-body-md text-on-surface-variant"> day(s)</span>
                </p>
              </Card>
            </div>

            {progress.trends.length > 0 && (
              <Card padding="lg" radius="2xl" className="mt-4">
                <p className="text-title-md text-on-surface">Score trend</p>
                <TrendChart points={progress.trends} />
                <ul className="mt-4 space-y-2">
                  {progress.trends.map((t) => (
                    <li
                      key={t.completedAt}
                      className="flex items-center justify-between text-body-sm"
                    >
                      <span className="text-on-surface-variant">{formatDate(t.completedAt)}</span>
                      <span className="text-on-surface">
                        Score {t.overallRecommendation ?? '—'}
                        {t.paceWpm !== null && ` · ${Math.round(t.paceWpm)} wpm`}
                        {t.fillerCount !== null && ` · ${t.fillerCount} fillers`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <h2 className="mt-8 text-title-md text-on-surface">Session history</h2>
            {progress.sessions.length === 0 ? (
              <div className="mt-3">
                <p className="text-body-md text-on-surface-variant">
                  No mocks yet. Your completed sessions will show up here.
                </p>
                <Button className="mt-4" onClick={() => navigate('/practice')}>
                  Start your first mock
                </Button>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-outline-variant rounded-xl bg-surface-container-low">
                {progress.sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-body-md text-on-surface">{s.title}</p>
                      <p className="text-body-sm text-on-surface-variant">
                        {s.source === 'library' ? 'Library pack' : 'From your JD'} ·{' '}
                        {formatDate(s.completedAt ?? s.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-body-sm text-on-surface-variant">
                        {s.status === 'completed'
                          ? `Score ${s.overallRecommendation ?? '—'}`
                          : s.status}
                      </span>
                      {s.status === 'completed' && (
                        <Link
                          to={`/practice/${s.id}/report`}
                          className="text-body-sm text-primary underline"
                        >
                          Report
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
