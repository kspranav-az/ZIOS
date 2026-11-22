import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import {
  ApiErrorResponse,
  fetchHistory,
  fetchMe,
  fetchReadiness,
  fetchWallet,
  type CandidateAccount,
  type CandidateHistoryResponse,
  type CandidateReadinessResponse,
  type CandidateWalletResponse,
} from '../api';
import { clearToken } from '../auth';

const READINESS_LABELS: Record<string, string> = {
  scoreBlend: 'Answer quality',
  paceScore: 'Pace',
  fillerScore: 'Filler words',
  structureScore: 'Structure',
};

const QUICK_LINKS = [
  { label: 'Resume intelligence', description: 'Parse, ATS-check and match your resume.', icon: 'description', to: '/resume' },
  { label: 'Progress', description: 'Trends, streaks and interview history.', icon: 'monitoring', to: '/progress' },
  { label: 'Wallet', description: 'Credit balance and ledger.', icon: 'account_balance_wallet', to: '/wallet' },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function HomePage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CandidateAccount | null>(null);
  const [readiness, setReadiness] = useState<CandidateReadinessResponse | null>(null);
  const [history, setHistory] = useState<CandidateHistoryResponse | null>(null);
  const [wallet, setWallet] = useState<CandidateWalletResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then((me) => setAccount(me.account))
      .catch((err: unknown) => {
        if (err instanceof ApiErrorResponse && (err.statusCode === 401 || err.statusCode === 403)) {
          clearToken();
          navigate('/login', { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load your profile.');
      });
    fetchReadiness()
      .then(setReadiness)
      .catch(() => {
        // Readiness is a bonus tile; a failure here must not block the home page.
      });
    fetchHistory()
      .then(setHistory)
      .catch(() => {
        // Recent activity is a bonus tile; failures must not block the page.
      });
    fetchWallet()
      .then(setWallet)
      .catch(() => {
        // Wallet chip is a bonus tile; failures must not block the page.
      });
  }, [navigate]);

  const recentSessions = (history?.practice.sessions ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-md text-on-surface">
            Welcome{account?.name ? `, ${account.name}` : ''}
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            {account?.targetRole
              ? `Practice mocks targeted at ${account.targetRole} roles. `
              : 'Run a mock interview and get an evidence-linked coaching report.'}
          </p>
        </div>
        {wallet && (
          <button
            type="button"
            onClick={() => navigate('/wallet')}
            className="flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-title-sm text-on-surface hover:bg-surface-container-high"
          >
            <Icon name="stars" className="text-lg text-primary" filled />
            {wallet.balance} credits
          </button>
        )}
      </div>

      {/* Primary CTA */}
      <Card padding="lg" radius="2xl" className="mt-6 bg-primary-container">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-title-lg text-on-primary-container">Start a practice mock</p>
            <p className="mt-1 text-body-md text-on-primary-container/80">
              Text, voice or live — every mock ends with a judged, evidence-linked report.
            </p>
          </div>
          <Button className="shrink-0" onClick={() => navigate('/practice')}>
            <span className="inline-flex items-center gap-2">
              <Icon name="play_arrow" className="text-lg" />
              Practice now
            </span>
          </Button>
        </div>
      </Card>

      {/* Main grid: recent activity + readiness */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card padding="lg" radius="2xl">
            <div className="flex items-center justify-between">
              <p className="text-title-md text-on-surface">Recent mocks</p>
              <button
                type="button"
                onClick={() => navigate('/progress')}
                className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline"
              >
                View all
                <Icon name="arrow_forward" className="text-base" />
              </button>
            </div>
            {recentSessions.length === 0 ? (
              <div className="mt-4 rounded-xl bg-surface-container-low p-6 text-center">
                <Icon name="smart_toy" className="text-3xl text-on-surface-variant" />
                <p className="mt-2 text-body-md text-on-surface">No mocks yet</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Your completed practice sessions will show up here.
                </p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-surface-container-high">
                {recentSessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-md text-on-surface">{session.title}</p>
                      <p className="text-body-sm text-on-surface-variant">
                        {formatDate(session.createdAt)}
                        {session.completedAt ? ` · completed ${formatDate(session.completedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {session.overallRecommendation !== null && (
                        <span className="rounded-full bg-primary-container px-2.5 py-0.5 text-body-sm text-on-primary-container">
                          {session.overallRecommendation}/5
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-body-sm ${
                          session.status === 'completed'
                            ? 'bg-surface-container text-on-surface-variant'
                            : session.status === 'judging'
                              ? 'bg-tertiary-container text-on-tertiary-container'
                              : 'bg-surface-container-high text-on-surface-variant'
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {readiness && (
            <Card padding="md" radius="xl" className="bg-surface-container-low">
              <div className="flex items-center justify-between">
                <p className="text-title-md text-on-surface">Readiness</p>
                {history && history.practice.streak.current > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 text-body-sm text-on-surface-variant">
                    <Icon name="local_fire_department" className="text-base text-tertiary" filled />
                    {history.practice.streak.current}-day streak
                  </span>
                )}
              </div>
              {readiness.readiness === null ? (
                <p className="mt-2 text-body-md text-on-surface-variant">
                  Run a mock to get your first readiness score.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-headline-md text-on-surface">
                    {readiness.readiness}
                    <span className="text-body-md text-on-surface-variant"> / 100</span>
                  </p>
                  <ul className="mt-3 space-y-2">
                    {Object.entries(readiness.components ?? {}).map(([key, value]) => (
                      <li key={key} className="flex items-center justify-between text-body-sm">
                        <span className="text-on-surface-variant">
                          {READINESS_LABELS[key] ?? key}
                        </span>
                        <span className="text-on-surface">{value}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-body-sm text-on-surface-variant">
                    From your last {readiness.sessionsUsed} judged mock
                    {readiness.sessionsUsed === 1 ? '' : 's'} · {readiness.formulaVersion}
                  </p>
                </>
              )}
            </Card>
          )}
          {error && (
            <p className="rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {QUICK_LINKS.map((link) => (
          <button
            key={link.to}
            type="button"
            onClick={() => navigate(link.to)}
            className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-4 text-left hover:bg-surface-container-high"
          >
            <Icon name={link.icon} className="mt-0.5 text-xl text-primary" />
            <span>
              <span className="block text-title-sm text-on-surface">{link.label}</span>
              <span className="mt-0.5 block text-body-sm text-on-surface-variant">
                {link.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
