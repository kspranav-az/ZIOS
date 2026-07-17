import {
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from '@zios/ui';

/**
 * Small form controls for the kit builder, styled from the same tokens as
 * @zios/ui's Input (rounded-xl outline-variant border, primary focus ring).
 * Kept local to employer-web — promote to @zios/ui only if a second app
 * needs them.
 */

const FIELD_CLASSES =
  'w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface';

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-label-bold text-primary uppercase tracking-wide mb-1.5"
    >
      {children}
    </label>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Array<{ value: string; label: string }>;
}

export function SelectField({ label, options, id, className = '', ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={className}>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <select id={selectId} className={FIELD_CLASSES} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextareaField({
  label,
  id,
  className = '',
  rows = 3,
  ...rest
}: TextareaFieldProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <div className={className}>
      <FieldLabel htmlFor={areaId}>{label}</FieldLabel>
      <textarea id={areaId} rows={rows} className={`${FIELD_CLASSES} resize-y`} {...rest} />
    </div>
  );
}

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, className = '', ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <input id={inputId} className={FIELD_CLASSES} {...rest} />
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

/** Switch-style boolean toggle (mandatory flag, proctoring-independent). */
export function Toggle({ label, checked, onChange, id }: ToggleProps) {
  const autoId = useId();
  const toggleId = id ?? autoId;
  return (
    <button
      type="button"
      id={toggleId}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 group"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-outline-variant'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
      <span className="text-sm text-on-surface group-hover:text-primary transition-colors">
        {label}
      </span>
    </button>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  id?: string;
}

/** +/- stepper used for the adaptive-ai depth cap (1–3, FR-E2-4). */
export function Stepper({ label, value, min, max, onChange, id }: StepperProps) {
  const autoId = useId();
  const stepperId = id ?? autoId;
  return (
    <div>
      <FieldLabel htmlFor={stepperId}>{label}</FieldLabel>
      <div
        className="inline-flex items-center gap-1 bg-white border border-outline-variant rounded-xl p-1"
        id={stepperId}
      >
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-primary hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <Icon name="remove" className="text-base" />
        </button>
        <span
          className="w-8 text-center text-sm font-label-bold text-on-surface"
          aria-live="polite"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-primary hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <Icon name="add" className="text-base" />
        </button>
      </div>
    </div>
  );
}
