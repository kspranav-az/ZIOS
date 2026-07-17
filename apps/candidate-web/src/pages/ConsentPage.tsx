import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '@zios/ui';
import { ApiErrorResponse, consentByToken } from '../api';
import { storeRecovery, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

export function ConsentPage() {
  const navigate = useNavigate();
  const { token, candidate, kit, setResolvedData } = useInterview();
  const [name, setName] = useState(candidate?.name ?? '');
  const [email, setEmail] = useState(candidate?.email ?? '');
  const [phone, setPhone] = useState(candidate?.phone ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <ErrorState
        title="Missing invite link"
        message="Please open this page from your invite link."
      />
    );
  }

  const handleAccept = async () => {
    if (!name.trim() || !email.trim()) {
      setError('Please enter your name and email to continue.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await consentByToken(token, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
      });
      storeRecovery(response.session.id, response.recoveryToken);
      setResolvedData({
        session: response.session,
        consent: response.consent,
        recoveryToken: response.recoveryToken,
      });
      navigate('/preflight', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not record consent. Please try again.',
      );
      setLoading(false);
    }
  };

  if (loading) return <LoadingState message="Setting up your interview…" />;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-headline-md text-on-surface">Before we begin</h1>
        <p className="mt-2 text-body-lg text-on-surface-variant">
          {kit?.title ? `Interview kit: ${kit.title}` : 'Your AI-assisted interview'}
        </p>

        <Card padding="lg" radius="2xl" className="mt-6">
          <h2 className="text-headline-sm text-on-surface">Consent & disclosure</h2>
          <ul className="mt-4 space-y-3 text-body-md text-on-surface-variant">
            <li className="flex gap-3">
              <span className="text-secondary-container">●</span>
              <span>
                This interview uses an AI system to ask questions and evaluate your responses. A
                human reviewer will make the final hiring decision.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-secondary-container">●</span>
              <span>
                For this text interview, no camera or microphone recording is made. We only collect
                the answers you type and basic interaction telemetry.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-secondary-container">●</span>
              <span>
                We measure job-relevant delivery behaviours (structure, clarity, relevance) and
                compare answers to the published rubric for each question. We do not infer emotion,
                personality, or facial traits.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-secondary-container">●</span>
              <span>
                Your data is retained only as long as necessary for this hiring process and in line
                with applicable law. You may withdraw consent or request deletion by contacting the
                organisation that invited you.
              </span>
            </li>
          </ul>
        </Card>

        <Card padding="lg" radius="2xl" className="mt-6">
          <h2 className="text-headline-sm text-on-surface">Confirm your identity</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              icon="person"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
            <Input
              label="Email"
              icon="mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Phone (optional)"
              icon="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </div>
          {error && (
            <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <Button className="mt-6 w-full sm:w-auto" size="lg" onClick={handleAccept}>
            I understand and agree — continue
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}
