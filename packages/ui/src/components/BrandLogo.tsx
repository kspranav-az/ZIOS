import zethetaLogo from '../assets/zetheta-logo.png';

export interface BrandLogoProps {
  /** Rendered width in px; height scales automatically (source is 266×69). */
  size?: number;
  alt?: string;
  className?: string;
}

/**
 * ZeTheta brand mark. Ported from the design reference's
 * src/components/BrandLogo.jsx — same asset, same sizing contract.
 */
export function BrandLogo({ size = 180, alt = 'ZeTheta', className = '' }: BrandLogoProps) {
  return (
    <img
      src={zethetaLogo}
      alt={alt}
      className={`block shrink-0 object-contain ${className}`}
      style={{ width: size, height: 'auto' }}
    />
  );
}
