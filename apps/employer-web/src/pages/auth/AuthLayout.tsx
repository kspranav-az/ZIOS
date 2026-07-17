import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, BrandLogo } from '@zios/ui';

/**
 * Split-screen auth frame ported from the design reference's
 * src/pages/auth/Login.jsx: white form panel on the left, deep-teal brand
 * panel (quote, rating, progress indicator) on the right, footer below.
 * The OTP flow reuses it across both steps (email → code).
 */
export function AuthLayout({ step, children }: { step: 1 | 2; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="bg-background text-on-background min-h-screen w-full overflow-x-hidden flex flex-col font-sans"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <main className="grow flex flex-col md:flex-row">
        {/* Form side */}
        <section className="w-full md:w-1/2 flex items-center justify-center p-5 md:p-16 bg-white">
          <div className="w-full max-w-md space-y-9">
            <div className="mb-2 pb-8 border-b border-[#e7edee]">
              <BrandLogo size={132} />
            </div>
            {children}
          </div>
        </section>

        {/* Brand / quote side */}
        <section className="hidden md:flex md:w-1/2 bg-primary relative overflow-hidden items-center justify-center p-8 lg:p-16">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary-container rounded-full blur-3xl opacity-20 -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-container rounded-full blur-3xl opacity-10 -ml-10 -mb-10" />

          <div className="relative z-10 w-full max-w-lg space-y-12">
            <div className="rounded-3xl overflow-hidden shadow-2xl bg-surface-container-highest/10 p-2 border border-white/10">
              <img
                alt="Professional team collaboration"
                className="w-full aspect-video object-cover rounded-2xl"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuC4S_1IQTnkomnj2kPRMmCd6H7iDSezwEAj71Y-AJN7OVhahsxrTpPp495BMLV9j-p4U07cHKMSfb9PnGaTgdAf_EqfAGukC2PH5XMUY9BQJXbZs8qikHgTf8WMw6AREOQG3ddR5DfqoxmOYTOOeaqd4bddO1h9NBLHsE5vbLOWD1RpE2q1TzJSZDNta5VaK_jRwZlyOSEnC14ffywtNDa8BqYKUh90lDODBv2SGkiv_XQYevdH8JXumMQf4DO43LfjpD9t3BK66rSo"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </div>

            <div className="space-y-6 text-white">
              <div className="flex gap-1 text-secondary-container">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="material-symbols-outlined"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    star
                  </span>
                ))}
              </div>
              <blockquote className="text-[22px] lg:text-headline-md font-bold leading-tight">
                &ldquo;ZeTheta didn&apos;t just speed up our hiring—it made it smarter. We found the
                perfect cultural fit in half the time.&rdquo;
              </blockquote>
              <div className="flex items-center gap-4">
                <Avatar
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuB2DHjVynUBLGmbg6C3B4DokxPK1vq-SY3Yj1JZOvEDDzZ5S6ELGT9QB8u6Yjvcq_g9ueHs_Td7L05OqGJGj285iOuKMThF6AgZ4hT6JpXaTE0rmBwqCRw_kXEK2EDisRvZaU6fRvS82zpC6l2Ug-fZcIrMcO96l0DkymFyfA3aOzEKGnrbZok4VSLIFbHa6AfsIMrF0BsjKQJCJhyLCQ6gYXh7BAOYUtAVW0-vQUE25Y2FQfqykA7l3tlGlmHefNIYZnszkrD65Zb4"
                  alt="Sarah Chen"
                  name="Sarah Chen"
                  size={48}
                  className="border-2 border-primary-fixed"
                />
                <div>
                  <p className="text-sm font-bold leading-none">Sarah Chen</p>
                  <p className="text-body-md text-primary-fixed opacity-80">
                    Head of Talent at InnovateCorp
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-8 flex items-center gap-6">
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary-container transition-all duration-500"
                  style={{ width: step === 1 ? '50%' : '100%' }}
                />
              </div>
              <span className="text-sm font-bold leading-none text-white/60">Step {step} of 2</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-outline-variant w-full py-8">
        <div className="flex flex-col md:flex-row justify-between items-center px-5 md:px-16 w-full max-w-container-max mx-auto gap-gutter opacity-90 hover:opacity-100 transition-all">
          <div className="text-headline-sm font-bold text-primary">ZeTheta</div>
          <div className="flex flex-wrap justify-center gap-6">
            {['Privacy Policy', 'Terms of Service', 'Support', 'Contact'].map((label) => (
              <a
                key={label}
                className="text-sm font-bold leading-none text-on-surface-variant hover:text-secondary hover:underline transition-all"
                href="#"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="text-sm font-bold leading-none text-on-surface-variant">
            © 2026 ZeTheta AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
