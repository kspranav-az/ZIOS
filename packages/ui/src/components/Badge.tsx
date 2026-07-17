import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type BadgeTone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Optional leading Material Symbols icon name. */
  icon?: string;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  // Reference chip styles (Recruiterdashboard / Upcominginterviews status chips)
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-error/10 text-error',
  neutral: 'bg-surface-container-highest text-on-surface-variant',
};

/**
 * Pill badge for statuses and counts — mirrors the reference's
 * rounded-full text-xs font-label-bold chips.
 */
export function Badge({ tone = 'primary', icon, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-label-bold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon && <Icon name={icon} className="text-xs" />}
      {children}
    </span>
  );
}
