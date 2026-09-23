import type { ConnectionQuality } from '../room-session';

export function ConnectionBadge({ quality }: { quality: ConnectionQuality }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          quality === 'good' ? 'bg-success' : 'bg-warning'
        }`}
      />
      <span className="text-label-bold text-on-surface-variant">
        {quality === 'good' ? 'Connected' : 'Connecting…'}
      </span>
    </div>
  );
}
