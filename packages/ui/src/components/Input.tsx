import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Leading Material Symbols icon name (mail, lock, person, …). */
  icon?: string;
  /** Error message — switches the field to the error state and renders it. */
  error?: string;
  /** Valid state — success border + trailing check icon (reference login form). */
  valid?: boolean;
  /** Extra control rendered at the right of the label row (e.g. a link). */
  labelAdornment?: React.ReactNode;
  id?: string;
}

/**
 * Labelled text field ported from the reference's auth forms (Login.jsx /
 * Signup.jsx): 14px bold primary label, leading icon, rounded-xl border with
 * error (#ba1a1a) / valid (#2f8f5b) states.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, icon, error, valid = false, labelAdornment, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const stateClasses = error
    ? 'border-error bg-[#fff5f5] focus:ring-error/10'
    : valid
      ? 'border-success focus:ring-primary/10'
      : 'border-outline-variant focus:ring-primary/10';

  const iconColor = error ? 'text-error' : valid ? 'text-primary-container' : 'text-outline';

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex justify-between items-center">
        <label className="text-sm font-bold leading-none text-primary" htmlFor={inputId}>
          {label}
        </label>
        {labelAdornment}
      </div>
      <div className="relative">
        {icon && (
          <span
            className={`material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${iconColor}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`w-full ${icon ? 'pl-12' : 'pl-4'} pr-11 py-3 bg-white border rounded-xl focus:ring-2 focus:border-primary outline-none transition-all text-base leading-relaxed text-on-surface ${stateClasses}`}
          {...rest}
        />
        {valid && !error && (
          <span
            className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-lg text-success"
            aria-hidden="true"
          >
            check_circle
          </span>
        )}
      </div>
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-error text-[13px] mt-1 flex items-center gap-1"
        >
          <Icon name="error" className="text-base" />
          {error}
        </p>
      )}
    </div>
  );
});
