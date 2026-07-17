export interface IconProps {
  /** Material Symbols ligature name, e.g. "dashboard", "video_chat". */
  name: string;
  className?: string;
  /** Filled variant of the symbol (FILL axis). */
  filled?: boolean;
}

/**
 * Material Symbols Outlined icon. Ported from the design reference's
 * RecruiterLayout.jsx `Icon` — the `material-symbols-outlined` font must be
 * loaded by the app (employer-web imports the `material-symbols` package).
 */
export function Icon({ name, className = '', filled = false }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={{
        fontVariationSettings: filled
          ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
          : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
      }}
    >
      {name}
    </span>
  );
}
