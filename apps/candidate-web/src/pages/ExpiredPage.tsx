import { Button, Card, Icon } from '@zios/ui';
import { useInterview } from '../InterviewContext';
import { PageShell } from '../components/PageShell';

export function ExpiredPage() {
  const { candidate } = useInterview();

  const subject = encodeURIComponent('Request to reschedule interview');
  const body = encodeURIComponent(
    'Hi,\n\nMy interview link has expired. Could you please resend or extend the invitation?\n\nThank you.',
  );
  const mailto = candidate?.email
    ? `mailto:${candidate.email}?subject=${subject}&body=${body}`
    : `mailto:?subject=${subject}&body=${body}`;

  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card padding="lg" radius="2xl" className="w-full max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error-container">
            <Icon name="event_busy" className="text-3xl text-on-error-container" />
          </div>
          <h1 className="mt-4 text-headline-sm text-on-surface">This link has expired</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            The interview invite is no longer valid. Contact the organisation that sent it to
            request a new one.
          </p>
          <Button
            className="mt-6 w-full"
            variant="outline"
            icon="mail"
            onClick={() => {
              window.location.href = mailto;
            }}
          >
            Request reschedule
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}
