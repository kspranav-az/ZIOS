import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@zios/ui';
import { ApiErrorResponse, fetchMe, logout, type CandidateAccount } from '../api';
import { clearToken } from '../auth';
import { PageShell } from '../components/PageShell';

export function HomePage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CandidateAccount | null>(null);
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
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md">
          <h1 className="text-headline-sm text-on-surface">
            Welcome{account?.name ? `, ${account.name}` : ''}
          </h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            {account?.targetRole
              ? `Practice mocks targeted at ${account.targetRole} roles. `
              : ''}
            Run a mock interview and get an evidence-linked coaching report.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate('/practice')}>
            Start a practice mock
          </Button>
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
    </PageShell>
  );
}
