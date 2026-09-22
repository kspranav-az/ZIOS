import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '@zios/ui';
import { ApiErrorResponse, patchMe } from '../api';
import { PageShell } from '../components/PageShell';

export function OnboardingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await patchMe({ name: name.trim(), targetRole: targetRole.trim() || undefined });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiErrorResponse ? err.message : 'Could not save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md">
          <h1 className="text-headline-sm text-on-surface">Set up your profile</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            We use this to tailor practice questions and coaching to your goals.
          </p>
          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Input
              label="Your name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Priya Sharma"
            />
            <Input
              label="Target role"
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="Backend Engineer"
            />
            {error && (
              <p className="rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading} disabled={name.trim().length === 0}>
              Continue
            </Button>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
