import type { FollowupPolicy, QuestionType } from '@zios/shared-types';
import { Icon } from '@zios/ui';
import { FieldLabel, Stepper } from './fields';

/**
 * Follow-up policy editor (FR-E2-4): none / fixed (author-written prompts) /
 * adaptive_ai (depth cap 1–3, open-ended only per §6.2).
 */

interface FollowupEditorProps {
  type: QuestionType;
  policy: FollowupPolicy;
  followupFixed: string[] | null;
  followupDepthCap: number | null;
  disabled: boolean;
  onChange: (patch: {
    followupPolicy?: FollowupPolicy;
    followupFixed?: string[] | null;
    followupDepthCap?: number | null;
  }) => void;
}

const POLICY_OPTIONS: Array<{ value: FollowupPolicy; label: string }> = [
  { value: 'none', label: 'No follow-ups' },
  { value: 'fixed', label: 'Fixed (author-written)' },
  { value: 'adaptive_ai', label: 'Adaptive AI' },
];

export function FollowupEditor({
  type,
  policy,
  followupFixed,
  followupDepthCap,
  disabled,
  onChange,
}: FollowupEditorProps) {
  const adaptiveAllowed = type === 'open_ended';
  const fixedLines = followupFixed ?? [];

  function changePolicy(next: FollowupPolicy) {
    if (next === 'fixed') {
      onChange({
        followupPolicy: 'fixed',
        followupFixed: fixedLines.length > 0 ? fixedLines : ['Can you elaborate on that?'],
        followupDepthCap: null,
      });
    } else if (next === 'adaptive_ai') {
      onChange({
        followupPolicy: 'adaptive_ai',
        followupFixed: null,
        followupDepthCap: followupDepthCap ?? 2,
      });
    } else {
      onChange({ followupPolicy: 'none', followupFixed: null, followupDepthCap: null });
    }
  }

  function updateLine(index: number, value: string) {
    const next = fixedLines.map((line, i) => (i === index ? value : line));
    onChange({ followupFixed: next });
  }

  function removeLine(index: number) {
    onChange({ followupFixed: fixedLines.filter((_, i) => i !== index) });
  }

  return (
    <div>
      <FieldLabel htmlFor="followup-policy">Follow-up policy</FieldLabel>
      <select
        id="followup-policy"
        value={policy}
        disabled={disabled}
        onChange={(event) => changePolicy(event.target.value as FollowupPolicy)}
        className="w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
      >
        {POLICY_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.value === 'adaptive_ai' && !adaptiveAllowed}
          >
            {option.label}
            {option.value === 'adaptive_ai' && !adaptiveAllowed ? ' (open-ended only)' : ''}
          </option>
        ))}
      </select>

      {policy === 'fixed' && (
        <div className="mt-3">
          <p className="text-xs text-on-surface-variant mb-2">
            Asked in order after the candidate answers.
          </p>
          <div className="space-y-2">
            {fixedLines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  aria-label={`Follow-up ${index + 1}`}
                  placeholder={`Follow-up question ${index + 1}`}
                  value={line}
                  disabled={disabled}
                  onChange={(event) => updateLine(index, event.target.value)}
                  className="flex-1 px-3 py-2 bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
                />
                <button
                  type="button"
                  aria-label={`Remove follow-up ${index + 1}`}
                  disabled={disabled || fixedLines.length <= 1}
                  onClick={() => removeLine(index)}
                  className="shrink-0 p-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40 disabled:hover:text-on-surface-variant"
                >
                  <Icon name="close" className="text-lg" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ followupFixed: [...fixedLines, ''] })}
            className="mt-2 inline-flex items-center gap-1 text-xs font-label-bold text-primary hover:underline disabled:opacity-50"
          >
            <Icon name="add" className="text-sm" /> Add follow-up
          </button>
        </div>
      )}

      {policy === 'adaptive_ai' && (
        <div className="mt-3 flex items-start gap-4">
          <Stepper
            label="Depth cap (1–3)"
            value={followupDepthCap ?? 2}
            min={1}
            max={3}
            onChange={(value) => onChange({ followupDepthCap: value })}
          />
          <p className="text-xs text-on-surface-variant mt-6 flex items-center gap-1">
            <Icon name="info" className="text-sm" />
            The AI probes the answer with at most this many follow-ups.
          </p>
        </div>
      )}
    </div>
  );
}
