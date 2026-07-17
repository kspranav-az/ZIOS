import type { ReactNode } from 'react';
import { BrandLogo } from '@zios/ui';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-margin-mobile py-4 sm:px-margin-desktop">
        <BrandLogo size={140} />
      </header>
      <main className="flex flex-1 flex-col px-margin-mobile pb-12 sm:px-margin-desktop">
        {children}
      </main>
    </div>
  );
}
