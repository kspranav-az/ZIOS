import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, OtpInput } from '@zios/ui';
import { ApiErrorResponse, requestCandidateOtp, verifyCandidateOtp } from '../api';
import { useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { PageShell } from '../components/PageShell';

export function OtpPage() {
  const navigate = useNavigate();
  const { token, candidate } = useInterview();
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpResetKey, setOtpResetKey] = useState(0);

  if (!token) {
    return (
      <ErrorState
        title="Missing invite link"
        message="Please open this page from your invite link."
      />
    );
  }

  const handleRequest = async () => {
    setLoading(true);
    setError(null);
    try {
      await requestCandidateOtp(token);
      setStep('verify');
      setOtpResetKey((k) => k + 1);
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not send the code. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (nextCode: string) => {
    setLoading(true);
    setError(null);
    try {
      await verifyCandidateOtp(token, { code: nextCode });
      navigate('/consent', { replace: true });
    } catch (err) {
      setCode('');
      setOtpResetKey((k) => k + 1);
      setError(err instanceof ApiErrorResponse ? err.message : 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'request') {
    return (
      <PageShell>
        <div className="flex flex-1 flex-col items-center justify-center">
          <Card padding="lg" radius="2xl" className="w-full max-w-md">
            <h1 className="text-headline-sm text-on-surface">Verify your identity</h1>
            <p className="mt-2 text-body-md text-on-surface-variant">
              We will send a one-time verification code to{' '}
              <strong className="text-on-surface">{candidate?.email}</strong>.
            </p>
            {error && (
              <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                {error}
              </p>
            )}
            <Button className="mt-6 w-full" onClick={handleRequest} loading={loading}>
              Send verification code
            </Button>
          </Card>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md">
          <h1 className="text-headline-sm text-on-surface">Enter verification code</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Enter the 6-digit code we sent to{' '}
            <strong className="text-on-surface">{candidate?.email}</strong>.
          </p>
          <div className="mt-6">
            <OtpInput
              length={6}
              resetKey={otpResetKey}
              onComplete={handleVerify}
              onChange={setCode}
              error={error ?? undefined}
              disabled={loading}
            />
          </div>
          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleRequest} disabled={loading}>
              Resend code
            </Button>
            <Button
              className="min-w-[120px]"
              onClick={() => {
                if (code.length === 6) void handleVerify(code);
              }}
              loading={loading}
              disabled={code.length !== 6}
            >
              Verify
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
