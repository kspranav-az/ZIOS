import { useState } from 'react';
import { Icon } from './Icon';

export interface AvatarProps {
  src?: string;
  alt: string;
  /** Used to derive initials when there is no image (or it fails to load). */
  name?: string;
  /** Pixel size (width = height). */
  size?: number;
  className?: string;
  /** Square (rounded-xl) variant used in interview/candidate rows. */
  square?: boolean;
}

/**
 * Avatar with initials fallback over the primary gradient. Ported from the
 * design reference's RecruiterLayout.jsx `Avatar`.
 */
export function Avatar({
  src,
  alt,
  name = 'User',
  size = 40,
  className = '',
  square = false,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const shapeClass = square ? 'rounded-xl' : 'rounded-full';

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center text-white font-bold ${shapeClass} ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.4,
          background: 'linear-gradient(135deg, #003441 0%, #0f4c5c 100%)',
        }}
        aria-label={alt}
        title={alt}
        role="img"
      >
        {initials || <Icon name="person" className="text-[0.55em]" />}
      </div>
    );
  }

  return (
    <img
      alt={alt}
      src={src}
      onError={() => setFailed(true)}
      className={`object-cover ${shapeClass} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
