import { BrandLogo } from '@zios/ui';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-gutter text-center">
      <BrandLogo size={160} />
      <p className="mt-6 text-body-md text-on-surface-variant">{message}</p>
    </div>
  );
}
