import { useEffect } from 'react';
import { Button, Card, Icon } from '@zios/ui';
import { SESSION_ID_KEY, useInterview } from '../InterviewContext';
import { PageShell } from '../components/PageShell';

export function CompletionPage() {
  const { candidate } = useInterview();

  useEffect(() => {
    try {
      const sessionId = sessionStorage.getItem(SESSION_ID_KEY);
      if (sessionId) {
        sessionStorage.removeItem(`zios:recoveryToken:${sessionId}`);
        sessionStorage.removeItem(`zios:answerDraft:${sessionId}`);
        sessionStorage.removeItem(SESSION_ID_KEY);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <Icon name="check_circle" className="text-3xl text-success" />
          </div>
          <h1 className="mt-4 text-headline-sm text-on-surface">Thank you!</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Your interview is complete. We have recorded your responses and they will be reviewed by
            the hiring team.
          </p>
          {candidate?.email && (
            <p className="mt-4 text-body-md text-on-surface-variant">
              A confirmation has been noted for{' '}
              <strong className="text-on-surface">{candidate.email}</strong>.
            </p>
          )}
          <Button className="mt-6 w-full" onClick={() => window.close()}>
            Close window
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}
