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

function digitAt(index: number): string {
  return DIGITS[index] as string;
}

/** Value of the digit at `index`, or 0 when the bound is exhausted/open. */
function lowerDigit(key: string | undefined, index: number): number {
  if (key === undefined || index >= key.length) {
    return 0;
  }
  return DIGITS.indexOf(key.charAt(index));
}

/**
 * Value of the digit at `index`, or `BASE` when the upper bound is
 * exhausted/open. `BASE` is treated as one past the largest digit, so the
 * midpoint calculation can always keep descending.
 */
function upperDigit(key: string | undefined, index: number): number {
  if (key === undefined || index >= key.length) {
    return BASE;
  }
  return DIGITS.indexOf(key.charAt(index));
}

/**
 * Returns a key strictly between `lo` and `hi`; either may be undefined for an
 * open boundary. Inputs must be keys produced by this module with lo < hi.
 */
export function positionBetween(lo?: string, hi?: string): string {
  let prefix = '';
  let i = 0;

  while (true) {
    const a = lowerDigit(lo, i);
    const b = upperDigit(hi, i);

    if (a + 1 < b) {
      // There is room for a digit strictly between the bounds.
      const mid = Math.floor((a + b) / 2);
      return prefix + digitAt(mid);
    }

    if (a === b) {
      // Shared leading digit; keep it and descend.
      prefix += digitAt(a);
      i += 1;
      continue;
    }

    // Adjacent digits: extend the lower bound's bucket. The recursive tail
    // guarantees a non-zero final digit, preserving the prefix-safety invariant.
    return (
      prefix +
      digitAt(a) +
      positionBetween(lo === undefined ? undefined : lo.slice(i + 1), undefined)
    );
  }
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
