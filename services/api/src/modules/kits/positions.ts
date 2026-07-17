/**
 * Fractional-index position keys (conflict-safe drag ordering, FR-E2-1).
 *
 * Keys are strings of base-62 digits interpreted as a fraction `0.xxxx`; plain
 * lexicographic string comparison matches numeric order because generated keys
 * never end in the zero digit ('0'), so prefix relationships always order the
 * same way numerically and lexicographically. Positions are opaque to clients:
 * read them, never edit them — reorder rebases the whole list.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digitValue(key: string, index: number): number {
  const char = key[index];
  return char === undefined ? 0 : DIGITS.indexOf(char);
}

function digitAt(index: number): string {
  return DIGITS[index] as string;
}

/**
 * Returns a key strictly between `lo` and `hi`; either may be undefined for an
 * open boundary. Inputs must be keys produced by this module with lo < hi.
 */
export function positionBetween(lo?: string, hi?: string): string {
  // Shared leading digits carry over unchanged.
  let i = 0;
  while (
    lo !== undefined &&
    hi !== undefined &&
    i < lo.length &&
    i < hi.length &&
    lo[i] === hi[i]
  ) {
    i += 1;
  }
  const prefix = (lo ?? '').slice(0, i);
  const loRest = (lo ?? '').slice(i);
  const hiRest = hi === undefined ? undefined : hi.slice(i);

  const loDigit = digitValue(loRest, 0);
  // An exhausted hi would mean hi is a prefix of lo (invalid input); treat it
  // as an open upper bound defensively instead of emitting an unordered key.
  const hiDigit = hiRest === undefined || hiRest.length === 0 ? BASE : digitValue(hiRest, 0);

  if (hiDigit - loDigit > 1) {
    const mid = Math.floor((loDigit + hiDigit) / 2);
    // mid ≥ 1 whenever the gap is ≥ 2, so the key never ends in '0'.
    return prefix + digitAt(mid);
  }
  // Adjacent digits: descend into the lo bucket; the recursive tail supplies
  // the non-zero final digit, keeping the no-trailing-'0' invariant.
  return prefix + digitAt(loDigit) + positionBetween(loRest.slice(1) || undefined, undefined);
}

/** Key after the current last position (or the first key of an empty list). */
export function positionAfter(last?: string): string {
  return positionBetween(last, undefined);
}

/** Key before the current first position. */
export function positionBefore(first?: string): string {
  return positionBetween(undefined, first);
}

/** Fresh sequential keys for a full reorder, in the given id order. */
export function assignPositions(orderedIds: string[]): Map<string, string> {
  const result = new Map<string, string>();
  let cursor: string | undefined;
  for (const id of orderedIds) {
    cursor = positionAfter(cursor);
    result.set(id, cursor);
  }
  return result;
}
