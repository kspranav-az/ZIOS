import { useState } from 'react';
import { Avatar, Badge, BrandLogo, Button, Card, Icon, Input, OtpInput } from '@zios/ui';

/**
 * Public catalog of the @zios/ui design system: tokens (colors, type,
 * radius, spacing) and every base component with its variants. Route:
 * /design-system.
 */

interface TokenSwatch {
  name: string;
  utility: string;
  value: string;
  /** Render text/border in on-color for dark swatches. */
  dark?: boolean;
}

const COLOR_GROUPS: { title: string; swatches: TokenSwatch[] }[] = [
  {
    title: 'Primary',
    swatches: [
      { name: 'primary', utility: 'bg-primary', value: '#003441', dark: true },
      { name: 'primary-container', utility: 'bg-primary-container', value: '#0f4c5c', dark: true },
      { name: 'on-primary-container', utility: 'bg-on-primary-container', value: '#87bbce' },
      { name: 'primary-fixed', utility: 'bg-primary-fixed', value: '#b6ebfe' },
      { name: 'primary-fixed-dim', utility: 'bg-primary-fixed-dim', value: '#9acee1' },
      {
        name: 'on-primary-fixed-variant',
        utility: 'bg-on-primary-fixed-variant',
        value: '#114d5d',
        dark: true,
      },
    ],
  },
  {
    title: 'Secondary',
    swatches: [
      { name: 'secondary', utility: 'bg-secondary', value: '#8e4f00', dark: true },
      { name: 'secondary-container', utility: 'bg-secondary-container', value: '#fe9415' },
      { name: 'secondary-fixed', utility: 'bg-secondary-fixed', value: '#ffdcc1' },
      {
        name: 'on-secondary-container',
        utility: 'bg-on-secondary-container',
        value: '#643600',
        dark: true,
      },
    ],
  },
  {
    title: 'Tertiary & Status',
    swatches: [
      { name: 'tertiary', utility: 'bg-tertiary', value: '#263134', dark: true },
      {
        name: 'tertiary-container',
        utility: 'bg-tertiary-container',
        value: '#3d484a',
        dark: true,
      },
      { name: 'error', utility: 'bg-error', value: '#ba1a1a', dark: true },
      { name: 'error-container', utility: 'bg-error-container', value: '#ffdad6' },
      { name: 'success', utility: 'bg-success', value: '#2f8f5b', dark: true },
    ],
  },
  {
    title: 'Surfaces & Ink',
    swatches: [
      { name: 'background / surface', utility: 'bg-background', value: '#f4faff' },
      {
        name: 'surface-container-lowest',
        utility: 'bg-surface-container-lowest',
        value: '#ffffff',
      },
      { name: 'surface-container-low', utility: 'bg-surface-container-low', value: '#e7f6ff' },
      { name: 'surface-container', utility: 'bg-surface-container', value: '#dff0fb' },
      { name: 'surface-container-high', utility: 'bg-surface-container-high', value: '#d9ebf5' },
      {
        name: 'surface-container-highest / surface-variant',
        utility: 'bg-surface-container-highest',
        value: '#d4e5f0',
      },
      {
        name: 'on-surface / on-background',
        utility: 'bg-on-surface',
        value: '#0d1e25',
        dark: true,
      },
      {
        name: 'on-surface-variant',
        utility: 'bg-on-surface-variant',
        value: '#40484b',
        dark: true,
      },
      { name: 'outline', utility: 'bg-outline', value: '#70787c', dark: true },
      { name: 'outline-variant', utility: 'bg-outline-variant', value: '#c0c8cb' },
    ],
  },
];

const TYPE_SCALE = [
  { name: 'display-lg', className: 'text-display-lg', sample: 'Hire with evidence' },
  { name: 'display-lg-mobile', className: 'text-display-lg-mobile', sample: 'Hire with evidence' },
  { name: 'headline-md', className: 'text-headline-md', sample: 'Candidate Pipeline' },
  { name: 'headline-sm', className: 'text-headline-sm', sample: 'Upcoming Interviews' },
  { name: 'body-lg', className: 'text-body-lg', sample: 'You have 3 interviews scheduled today.' },
  { name: 'body-md', className: 'text-body-md', sample: 'Manage and track your interviews.' },
  {
    name: 'label-bold',
    className: 'text-label-bold uppercase tracking-wider',
    sample: 'Total Candidates',
  },
];

const ICONS = [
  'dashboard',
  'group',
  'video_chat',
  'analytics',
  'calendar_add_on',
  'search',
  'notifications',
  'help',
  'logout',
  'mail',
  'check_circle',
  'error',
  'schedule',
  'person_add',
  'auto_awesome',
];

export function DesignSystemPage() {
  const [otpDemo, setOtpDemo] = useState('');

  return (
    <div className="min-h-screen bg-background text-on-background font-sans">
      <header className="bg-white border-b border-surface-variant/60 px-5 md:px-16 py-6 flex items-center justify-between max-w-container-max mx-auto w-full">
        <BrandLogo size={150} />
        <Badge tone="primary">@zios/ui · Design System</Badge>
      </header>

      <main className="max-w-container-max mx-auto px-5 md:px-16 py-10 space-y-16">
        <section className="space-y-2">
          <h1 className="text-display-lg-mobile font-display-lg-mobile text-primary">
            InterviewOS Design System
          </h1>
          <p className="text-body-lg text-on-surface-variant max-w-2xl">
            Theme tokens and base components ported from the ZeTheta design reference. Every value
            below is a CSS variable in{' '}
            <code className="text-primary font-bold">@zios/ui tokens.css</code> mapped to a Tailwind
            utility — change the variable, re-theme everything.
          </p>
        </section>

        {/* ---- Color tokens ---- */}
        <section className="space-y-6">
          <SectionTitle title="Color tokens" subtitle="Material-style roles · name → value" />
          {COLOR_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h3 className="text-label-bold uppercase tracking-wider text-on-surface-variant">
                {group.title}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {group.swatches.map((swatch) => (
                  <div
                    key={swatch.name}
                    className="rounded-2xl overflow-hidden border border-outline-variant/50 bg-white"
                  >
                    <div
                      className={`h-20 flex items-end p-3 ${swatch.utility} ${
                        swatch.dark ? 'text-white' : 'text-on-surface'
                      }`}
                    >
                      <span className="text-xs font-bold">{swatch.value}</span>
                    </div>
                    <div className="p-3">
                      <p className="text-xs font-bold text-on-surface">{swatch.name}</p>
                      <p className="text-[11px] text-on-surface-variant">{swatch.utility}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ---- Typography ---- */}
        <section className="space-y-6">
          <SectionTitle title="Typography" subtitle="Plus Jakarta Sans · 400 / 500 / 700 / 800" />
          <Card radius="2xl" padding="lg" className="space-y-6">
            {TYPE_SCALE.map((type) => (
              <div
                key={type.name}
                className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-8 border-b border-surface-variant/40 last:border-0 pb-4 last:pb-0"
              >
                <code className="text-xs text-on-surface-variant w-44 shrink-0">{type.name}</code>
                <span className={`${type.className} text-primary`}>{type.sample}</span>
              </div>
            ))}
          </Card>
        </section>

        {/* ---- Buttons ---- */}
        <section className="space-y-6">
          <SectionTitle title="Button" subtitle="Variants × sizes × states" />
          <Card radius="2xl" padding="lg" className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <Button variant="primary" size="lg" icon="calendar_add_on">
                Schedule Interview
              </Button>
              <Button variant="secondary" size="lg" icon="group">
                View Candidates
              </Button>
              <Button variant="outline" size="md">
                View Profile
              </Button>
              <Button variant="ghost" size="md">
                Ghost
              </Button>
              <Button variant="danger" size="md" icon="delete">
                Delete
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button loading size="md">
                Loading
              </Button>
              <Button disabled size="md">
                Disabled
              </Button>
            </div>
          </Card>
        </section>

        {/* ---- Badge ---- */}
        <section className="space-y-6">
          <SectionTitle title="Badge" subtitle="Status chips" />
          <Card radius="2xl" padding="lg">
            <div className="flex flex-wrap gap-3">
              <Badge tone="primary">Completed</Badge>
              <Badge tone="secondary" icon="bolt">
                Hot
              </Badge>
              <Badge tone="success">Hired</Badge>
              <Badge tone="warning">Screening</Badge>
              <Badge tone="error" icon="cancel">
                Cancelled
              </Badge>
              <Badge tone="neutral">Applied</Badge>
            </div>
          </Card>
        </section>

        {/* ---- Inputs ---- */}
        <section className="space-y-6">
          <SectionTitle title="Input" subtitle="Default, valid, error and disabled states" />
          <Card radius="2xl" padding="lg" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input label="Email Address" icon="mail" placeholder="name@company.com" />
            <Input label="Valid email" icon="mail" defaultValue="sarah@zetheta.com" valid />
            <Input
              label="With error"
              icon="lock"
              defaultValue="123"
              error="Please enter a valid email address."
            />
            <Input label="Disabled" icon="person" placeholder="Not editable" disabled />
          </Card>
        </section>

        {/* ---- OTP input ---- */}
        <section className="space-y-6">
          <SectionTitle title="OtpInput" subtitle="6-digit one-time code — try typing or pasting" />
          <Card radius="2xl" padding="lg" className="space-y-4">
            <OtpInput length={6} onComplete={setOtpDemo} autoFocus={false} />
            <p className="text-sm text-on-surface-variant">
              Last completed code: <span className="font-bold text-primary">{otpDemo || '—'}</span>
            </p>
            <OtpInput
              length={6}
              onComplete={() => {}}
              error="That code doesn't match our email."
              autoFocus={false}
            />
          </Card>
        </section>

        {/* ---- Cards, avatar, icons ---- */}
        <section className="space-y-6">
          <SectionTitle title="Card, Avatar & Icons" subtitle="Surfaces and identity primitives" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card radius="2xl" padding="lg" className="space-y-4">
              <p className="text-label-bold uppercase tracking-wider text-on-surface-variant">
                Avatars
              </p>
              <div className="flex items-center gap-4">
                <Avatar alt="Sarah Miller" name="Sarah Miller" size={48} />
                <Avatar alt="Marcus Chen" name="Marcus Chen" size={48} square />
                <Avatar alt="Single" name="Single" size={48} />
                <Avatar
                  src="https://invalid.example/avatar.png"
                  alt="Fallback demo"
                  name="Fallback Demo"
                  size={48}
                />
              </div>
              <p className="text-xs text-on-surface-variant">
                Initials over the primary gradient; broken images fall back automatically.
              </p>
            </Card>
            <Card radius="2xl" padding="lg" className="space-y-4">
              <p className="text-label-bold uppercase tracking-wider text-on-surface-variant">
                Material Symbols (filled & outlined)
              </p>
              <div className="flex flex-wrap gap-4 text-primary">
                {ICONS.map((name) => (
                  <span key={name} className="flex flex-col items-center gap-1 w-16">
                    <Icon name={name} className="text-2xl" />
                    <span className="text-[10px] text-on-surface-variant">{name}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </section>

        {/* ---- Layout tokens ---- */}
        <section className="space-y-6 pb-8">
          <SectionTitle title="Radius, spacing & shadow" subtitle="Layout rhythm tokens" />
          <Card radius="2xl" padding="lg" className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <Token label="radius / DEFAULT" value="0.25rem" />
            <Token label="radius-lg" value="0.5rem" />
            <Token label="radius-xl" value="0.75rem" />
            <Token label="radius-full" value="9999px" />
            <Token label="spacing-base" value="8px" />
            <Token label="spacing-gutter" value="24px" />
            <Token label="spacing-margin-desktop" value="64px" />
            <Token label="container-max" value="1280px" />
            <Token label="shadow-card" value="0 4px 20px rgba(0,0,0,.04)" />
            <Token label="shadow-cta" value="0 6px 16px rgba(0,52,65,.25)" />
          </Card>
        </section>
      </main>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-headline-sm font-headline-sm text-primary">{title}</h2>
      <p className="text-sm text-on-surface-variant mt-1">{subtitle}</p>
    </div>
  );
}

function Token({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-on-surface">{label}</p>
      <p className="text-[11px] text-on-surface-variant">{value}</p>
    </div>
  );
}
