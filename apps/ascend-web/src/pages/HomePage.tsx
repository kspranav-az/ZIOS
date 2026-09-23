import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@zios/ui';
import {
  ApiErrorResponse,
  fetchMe,
  fetchReadiness,
  logout,
  type CandidateAccount,
  type CandidateReadinessResponse,
} from '../api';
import { clearToken } from '../auth';

const READINESS_LABELS: Record<string, string> = {
  scoreBlend: 'Answer quality',
  paceScore: 'Pace',
  fillerScore: 'Filler words',
  structureScore: 'Structure',
};

export function HomePage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CandidateAccount | null>(null);
  const [readiness, setReadiness] = useState<CandidateReadinessResponse | null>(null);
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
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearToken();
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <Card padding="lg" radius="2xl" className="w-full max-w-md">
        <h1 className="text-headline-sm text-on-surface">
          Welcome{account?.name ? `, ${account.name}` : ''}
        </h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          {account?.targetRole ? `Practice mocks targeted at ${account.targetRole} roles. ` : ''}
          Run a mock interview and get an evidence-linked coaching report.
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate('/practice')}>
          Start a practice mock
        </Button>
        <Button variant="outline" className="mt-3 w-full" onClick={() => navigate('/resume')}>
          Resume intelligence
        </Button>
        <Button variant="outline" className="mt-3 w-full" onClick={() => navigate('/progress')}>
          Progress
        </Button>
        <Button variant="outline" className="mt-3 w-full" onClick={() => navigate('/wallet')}>
          Wallet
        </Button>

        {readiness && (
          <Card padding="md" radius="xl" className="mt-6 bg-surface-container-low">
            <p className="text-title-md text-on-surface">Readiness</p>
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
          <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}
        <Button variant="outline" className="mt-3 w-full" onClick={() => void handleLogout()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
