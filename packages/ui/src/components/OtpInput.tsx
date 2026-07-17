import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface OtpInputProps {
  /** Number of digits — the backend issues 6-digit codes. */
  length?: number;
  /** Called with the full code whenever all digits are filled. */
  onComplete: (code: string) => void;
  /** Called with the current (possibly partial) code on every change. */
  onChange?: (code: string) => void;
  /** Error message — switches boxes to the error state and renders it. */
  error?: string;
  /** Disables all boxes (e.g. while verifying). */
  disabled?: boolean;
  /** Clears the boxes when this value changes (e.g. after a failed attempt). */
  resetKey?: unknown;
  autoFocus?: boolean;
}

const DIGIT = /^\d$/;

/**
 * 6-digit one-time-code input: one box per digit, auto-advance on type,
 * backspace moves back, paste distributes digits, arrow keys navigate.
 * Styled with the reference's rounded-xl border + error ring language.
 */
export function OtpInput({
  length = 6,
  onComplete,
  onChange,
  error,
  disabled = false,
  resetKey,
  autoFocus = true,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(length).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setDigits(Array<string>(length).fill(''));
  }, [resetKey, length]);

  useEffect(() => {
    if (autoFocus && !disabled) refs.current[0]?.focus();
  }, [autoFocus, disabled]);

  function commit(next: string[]) {
    setDigits(next);
    const code = next.join('');
    onChange?.(code);
    if (code.length === length && next.every((d) => DIGIT.test(d))) {
      onComplete(code);
    }
  }

  function handleChange(index: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    commit(next);
    if (char && index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        commit(next);
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        const next = [...digits];
        next[index - 1] = '';
        commit(next);
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    const next = Array<string>(length).fill('');
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i] ?? '';
    commit(next);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="space-y-1.5">
      <div
        className="flex gap-2 sm:gap-3 justify-start"
        role="group"
        aria-label="One-time verification code"
      >
        {digits.map((digit, index) => (
          <input
            // Stable per-position keys keep focus behavior predictable.
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={digit}
            disabled={disabled}
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={Boolean(error)}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-xl border bg-white outline-none transition-all focus:ring-2 disabled:opacity-60 ${
              error
                ? 'border-error bg-[#fff5f5] text-error focus:ring-error/10'
                : 'border-outline-variant text-on-surface focus:border-primary focus:ring-primary/10'
            }`}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-error text-[13px] mt-1 flex items-center gap-1">
          <Icon name="error" className="text-base" />
          {error}
        </p>
      )}
    </div>
  );
}
