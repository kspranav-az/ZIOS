import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Padding preset: 'md' = p-6 (stat cards), 'lg' = p-8 (panels). */
  padding?: 'none' | 'md' | 'lg';
  /** Corner radius: 'xl' = rounded-2xl (cards), '2xl' = rounded-3xl (panels). */
  radius?: 'xl' | '2xl';
  children: ReactNode;
}

const PADDING_CLASSES = {
  none: '',
  md: 'p-6',
  lg: 'p-8',
} as const;

const RADIUS_CLASSES = {
  xl: 'rounded-2xl',
  '2xl': 'rounded-3xl',
} as const;

/**
 * Elevated surface used across the reference dashboards:
 * bg-surface-container-lowest, soft shadow, hairline surface-variant border.
 */
export function Card({
  padding = 'md',
  radius = 'xl',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`bg-surface-container-lowest shadow-card border border-surface-variant/50 ${RADIUS_CLASSES[radius]} ${PADDING_CLASSES[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
