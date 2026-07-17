import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading Material Symbols icon name. */
  icon?: string;
  /** Shows a spinning progress icon and disables the button. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Reference: w-full py-4 bg-[#003441] → hover:bg-[#0f4c5c], lift on hover
  primary:
    'bg-primary text-on-primary shadow-md hover:bg-primary-container hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] disabled:hover:bg-primary disabled:hover:shadow-md disabled:hover:translate-y-0',
  // Reference: bg-secondary-container (#fe9415) text-on-secondary-container
  secondary:
    'bg-secondary-container text-on-secondary-container shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] disabled:hover:translate-y-0',
  // Reference: border border-primary text-primary → hover:bg-primary hover:text-white
  outline:
    'border border-primary text-primary hover:bg-primary hover:text-on-primary disabled:hover:bg-transparent disabled:hover:text-primary',
  ghost: 'text-primary hover:bg-surface-container-high',
  danger:
    'bg-error text-on-error shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] disabled:hover:translate-y-0',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-xs rounded-lg gap-2',
  md: 'px-6 py-3 text-sm rounded-xl gap-2',
  lg: 'px-8 py-4 text-base rounded-xl gap-3',
};

/**
 * Primary action control, styled after the reference's CTA buttons
 * (Login.jsx submit, Recruiterdashboard.jsx header actions).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap font-label-bold text-label-bold tracking-wide transition-all disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Icon name="progress_activity" className="animate-spin text-[1.2em]" />
      ) : (
        icon && <Icon name={icon} className="text-[1.2em]" />
      )}
      {children}
    </button>
  );
}
