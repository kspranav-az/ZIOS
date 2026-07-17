import { useState, type ReactNode } from 'react';
import type { Kit, InterviewMode, ProctoringLevel } from '@zios/shared-types';
import { Icon } from '@zios/ui';
import type { KitDraftPatch } from '../KitBuilderPage';
import { FieldLabel, TextField, TextareaField } from './fields';

/** Left rail of the builder: kit settings as an accordion (FR-E2-1). */

interface KitSettingsRailProps {
  kit: Kit;
  disabled: boolean;
  onPatch: (patch: KitDraftPatch) => void;
}

const MODE_OPTIONS: Array<{ value: InterviewMode; label: string; icon: string }> = [
  { value: 'text', label: 'Text', icon: 'chat' },
  { value: 'voice', label: 'Voice', icon: 'mic' },
  { value: 'video', label: 'Video', icon: 'videocam' },
];

const PROCTORING_OPTIONS: Array<{ value: ProctoringLevel; label: string; hint: string }> = [
  { value: 'none', label: 'None', hint: 'No proctoring signals captured.' },
  { value: 'standard', label: 'Standard', hint: 'Tab-switch and focus signals.' },
  { value: 'strict', label: 'Strict', hint: 'Standard plus camera presence checks.' },
];

function AccordionSection({
  id,
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-surface-variant/50 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`settings-section-${id}`}
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 px-1 group"
      >
        <span className="flex items-center gap-2 font-label-bold text-label-bold text-primary">
          <Icon
            name={icon}
            className="text-lg text-on-surface-variant group-hover:text-primary transition-colors"
          />
          {title}
        </span>
        <Icon
          name="expand_more"
          className={`text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={`settings-section-${id}`} className="pb-5 px-1 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function KitSettingsRail({ kit, disabled, onPatch }: KitSettingsRailProps) {
  const [openSections, setOpenSections] = useState({ basics: true, delivery: true, copy: false });

  function toggle(section: keyof typeof openSections) {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  const { settings } = kit;
  const capMinutes = Math.round(settings.totalTimeCapSec / 60);

  return (
    <aside
      aria-label="Kit settings"
      className="bg-surface-container-lowest shadow-card border border-surface-variant/50 rounded-2xl px-5 py-2 lg:sticky lg:top-24"
    >
      <AccordionSection
        id="basics"
        title="Basics"
        icon="badge"
        open={openSections.basics}
        onToggle={() => toggle('basics')}
      >
        <TextField
          label="Kit title"
          value={kit.title}
          disabled={disabled}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
        <TextField
          label="Role"
          placeholder="e.g. Backend Engineer"
          value={kit.role ?? ''}
          disabled={disabled}
          onChange={(event) => onPatch({ role: event.target.value })}
        />
        <TextField
          label="Level"
          placeholder="e.g. Mid-level"
          value={kit.level ?? ''}
          disabled={disabled}
          onChange={(event) => onPatch({ level: event.target.value })}
        />
        <TextField
          label="Language"
          value={settings.language}
          disabled={disabled}
          onChange={(event) => onPatch({ language: event.target.value })}
        />
      </AccordionSection>

      <AccordionSection
        id="delivery"
        title="Delivery"
        icon="tune"
        open={openSections.delivery}
        onToggle={() => toggle('delivery')}
      >
        <div>
          <FieldLabel>Interview mode</FieldLabel>
          <div
            className="grid grid-cols-3 gap-1 bg-surface-container-low rounded-xl p-1"
            role="radiogroup"
            aria-label="Interview mode"
          >
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.mode === option.value}
                disabled={disabled}
                onClick={() => onPatch({ mode: option.value })}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-label-bold transition-colors ${
                  settings.mode === option.value
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                <Icon name={option.icon} className="text-base" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Proctoring level</FieldLabel>
          <div className="space-y-2" role="radiogroup" aria-label="Proctoring level">
            {PROCTORING_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.proctoringLevel === option.value}
                disabled={disabled}
                onClick={() => onPatch({ proctoringLevel: option.value })}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  settings.proctoringLevel === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant bg-white hover:border-primary/40'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-label-bold text-primary">
                  <Icon
                    name={
                      settings.proctoringLevel === option.value
                        ? 'radio_button_checked'
                        : 'radio_button_unchecked'
                    }
                    className="text-base"
                  />
                  {option.label}
                </span>
                <span className="block text-xs text-on-surface-variant mt-0.5 ml-6">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="time-cap">Total time cap (minutes)</FieldLabel>
          <input
            id="time-cap"
            type="number"
            min={1}
            step={1}
            value={capMinutes}
            disabled={disabled}
            onChange={(event) => {
              const minutes = Number.parseInt(event.target.value, 10);
              if (Number.isInteger(minutes) && minutes > 0) {
                onPatch({ totalTimeCapSec: minutes * 60 });
              }
            }}
            className="w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
          />
          <p className="text-xs text-on-surface-variant mt-1.5">
            Publish is refused when the estimated duration exceeds this cap.
          </p>
        </div>
      </AccordionSection>

      <AccordionSection
        id="copy"
        title="Candidate-facing copy"
        icon="article"
        open={openSections.copy}
        onToggle={() => toggle('copy')}
      >
        <TextareaField
          label="Intro text"
          placeholder="Shown on the candidate's welcome screen"
          value={settings.introText ?? ''}
          disabled={disabled}
          onChange={(event) => onPatch({ introText: event.target.value || null })}
        />
        <TextareaField
          label="Outro text"
          placeholder="Shown after the last question"
          value={settings.outroText ?? ''}
          disabled={disabled}
          onChange={(event) => onPatch({ outroText: event.target.value || null })}
        />
        <TextField
          label="Employer logo URL"
          placeholder="https://…"
          type="url"
          value={settings.logoUrl ?? ''}
          disabled={disabled}
          onChange={(event) => onPatch({ logoUrl: event.target.value || null })}
        />
      </AccordionSection>
    </aside>
  );
}
