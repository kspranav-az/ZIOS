import { describe, expect, it } from 'vitest';
import { isLegalTransition, transition, type SessionState } from './state-machine';

const ALL_STATES: SessionState[] = [
  'invited',
  'consented',
  'preflight',
  'live',
  'completed',
  'abandoned',
  'scoring',
  'reported',
  'reviewed',
];

describe('session state machine', () => {
  it('allows every legal transition', () => {
    const legal: Array<[SessionState, SessionState]> = [
      ['invited', 'consented'],
      ['consented', 'preflight'],
      ['preflight', 'live'],
      ['live', 'completed'],
      ['live', 'abandoned'],
      ['abandoned', 'invited'],
      ['abandoned', 'consented'],
      ['scoring', 'reported'],
      ['reported', 'reviewed'],
    ];
    for (const [from, to] of legal) {
      expect(isLegalTransition(from, to)).toBe(true);
      expect(() => transition(from, to)).not.toThrow();
    }
  });

  it('rejects illegal transitions', () => {
    const illegal: Array<[SessionState, SessionState]> = [
      ['invited', 'live'],
      ['completed', 'live'],
      ['abandoned', 'completed'],
      ['live', 'preflight'],
      ['scoring', 'completed'],
    ];
    for (const [from, to] of illegal) {
      expect(isLegalTransition(from, to)).toBe(false);
      expect(() => transition(from, to)).toThrow(/ILLEGAL_TRANSITION/);
    }
  });

  it('rejects all transitions from terminal states except the defined ones', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (from === to) continue;
        const allowed = isLegalTransition(from, to);
        if (!allowed) {
          expect(() => transition(from, to)).toThrow(/ILLEGAL_TRANSITION/);
        }
      }
    }
  });
});
