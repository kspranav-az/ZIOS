import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, OtpInput } from '@zios/ui';
import { ApiErrorResponse, requestOtp, verifyOtp } from '../api';
import { setToken } from '../auth';
import { PageShell } from '../components/PageShell';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpResetKey, setOtpResetKey] = useState(0);

  const handleRequest = async () => {
    setLoading(true);
    setError(null);
    try {
      await requestOtp(email.trim());
      setStep('verify');
      setOtpResetKey((k) => k + 1);
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse ? err.message : 'Could not send the code. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyOtp(email.trim(), code);
      setToken(result.session.token);
      navigate(result.isNewUser ? '/onboarding' : '/', { replace: true });
    } catch (err) {
      setOtpResetKey((k) => k + 1);
      setError(err instanceof ApiErrorResponse ? err.message : 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md">
          {step === 'request' ? (
            <>
              <h1 className="text-headline-sm text-on-surface">Sign in to Ascend</h1>
              <p className="mt-2 text-body-md text-on-surface-variant">
                Practice interviews against AI interviewers — with evidence-linked coaching after
                every mock.
              </p>
              <form
                className="mt-6 flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRequest();
                }}
              >
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
                {error && (
                  <p className="rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                    {error}
                  </p>
                )}
                <Button type="submit" loading={loading} disabled={email.trim().length === 0}>
                  Send sign-in code
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-headline-sm text-on-surface">Enter your sign-in code</h1>
              <p className="mt-2 text-body-md text-on-surface-variant">
                We sent a 6-digit code to <strong className="text-on-surface">{email}</strong>.
              </p>
              <div className="mt-6">
                <OtpInput
                  length={6}
                  onComplete={(code) => void handleVerify(code)}
                  resetKey={otpResetKey}
                  disabled={loading}
                />
              </div>
              {error && (
                <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                  {error}
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
