import { Button, Card, Icon } from '@zios/ui';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  onReturnHome?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  onReturnHome,
}: ErrorStateProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-gutter py-8">
      <Card padding="lg" radius="2xl" className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error-container">
          <Icon name="error" className="text-3xl text-on-error-container" />
        </div>
        <h1 className="mt-4 text-headline-sm text-on-surface">{title}</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">{message}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {onRetry && (
            <Button onClick={onRetry} icon="refresh">
              Try again
            </Button>
          )}
          {onReturnHome && (
            <Button variant="outline" onClick={onReturnHome}>
              Return to home
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
