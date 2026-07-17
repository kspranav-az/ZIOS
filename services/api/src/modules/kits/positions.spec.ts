import { describe, expect, it } from 'vitest';
import { assignPositions, positionAfter, positionBefore, positionBetween } from './positions';

/** Property check: a generated key must sort strictly between its bounds. */
function expectBetween(lo: string | undefined, key: string, hi: string | undefined): void {
  if (lo !== undefined) expect(key > lo).toBe(true);
  if (hi !== undefined) expect(key < hi).toBe(true);
}

describe('positions (fractional indexing)', () => {
  it('generates a first key for an empty list', () => {
    const key = positionAfter();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('appends strictly increasing keys', () => {
    let cursor: string | undefined;
    const keys: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      cursor = positionAfter(cursor);
      keys.push(cursor);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('prepends strictly decreasing keys', () => {
    let cursor: string | undefined;
    const keys: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      cursor = positionBefore(cursor);
      keys.unshift(cursor);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('finds midpoints between adjacent keys', () => {
    const a = positionAfter();
    const b = positionAfter(a);
    const mid = positionBetween(a, b);
    expectBetween(a, mid, b);
    // And again between the midpoint and each bound, repeatedly.
    const quarter = positionBetween(a, mid);
    expectBetween(a, quarter, mid);
    const threeQuarter = positionBetween(mid, b);
    expectBetween(mid, threeQuarter, b);
  });

  it('keeps ordering after 200 random insertions between neighbors', () => {
    // Simulate drag reordering: start with 10 items, then repeatedly insert
    // at random boundaries and verify the list stays correctly sorted.
    const keys: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      keys.push(positionAfter(keys[keys.length - 1]));
    }
    for (let i = 0; i < 200; i += 1) {
      const index = Math.floor(Math.random() * (keys.length + 1));
      const lo = index === 0 ? undefined : keys[index - 1];
      const hi = index === keys.length ? undefined : keys[index];
      const key = positionBetween(lo, hi);
      expectBetween(lo, key, hi);
      keys.splice(index, 0, key);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never emits keys ending in the zero digit (prefix-safety invariant)', () => {
    const keys: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const index = Math.floor(Math.random() * (keys.length + 1));
      const key = positionBetween(keys[index - 1], keys[index]);
      expect(key.endsWith('0')).toBe(false);
      keys.splice(index, 0, key);
    }
  });

  it('assignPositions returns fresh ordered keys for a full rebase', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const positions = assignPositions(ids);
    expect(positions.size).toBe(4);
    const ordered = ids.map((id) => positions.get(id) as string);
    expect([...ordered].sort()).toEqual(ordered);
    expect(new Set(ordered).size).toBe(4);
  });
});
