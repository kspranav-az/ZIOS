import { useEffect, useState } from 'react';

/** Whole seconds remaining until `targetMs` (null → 0), ticking every second. */
export function useCountdown(targetMs: number | null): number {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    targetMs === null ? 0 : Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)),
  );

  useEffect(() => {
    if (targetMs === null) {
      setSecondsLeft(0);
      return undefined;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  return secondsLeft;
}

/** Formats a seconds count as m:ss for countdown copy. */
export function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
