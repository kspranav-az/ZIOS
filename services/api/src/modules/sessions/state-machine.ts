/**
 * Session state machine (PRD §10).
 *
 * Legal transitions:
 *   invited -> consented
 *   consented -> preflight
 *   preflight -> live
 *   live -> completed
 *   live -> abandoned
 *   abandoned -> invited  (recovery / re-engagement)
 *
 * Reporting states (scoring -> reported -> reviewed) are not exercised in
 * Phase 03 but are part of the status check constraint.
 */

export type SessionState =
  | 'invited'
  | 'consented'
  | 'preflight'
  | 'live'
  | 'completed'
  | 'abandoned'
  | 'scoring'
  | 'reported'
  | 'reviewed';

export type SessionEventType =
  | 'session.created'
  | 'session.consented'
  | 'session.preflight_passed'
  | 'session.started'
  | 'session.turn_answered'
  | 'session.completed'
  | 'session.abandoned'
  | 'session.recovered';

const LEGAL_TRANSITIONS: Partial<Record<SessionState, Partial<Record<SessionState, boolean>>>> = {
  invited: { consented: true },
  consented: { preflight: true },
  preflight: { live: true },
  live: { completed: true, abandoned: true },
  completed: {},
  abandoned: { invited: true, consented: true },
  scoring: { reported: true },
  reported: { reviewed: true },
  reviewed: {},
};

export function isLegalTransition(from: SessionState, to: SessionState): boolean {
  return LEGAL_TRANSITIONS[from]?.[to] === true;
}

export function transition(from: SessionState, to: SessionState): void {
  if (!isLegalTransition(from, to)) {
    throw new Error(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
  }
}

export function eventForTransition(to: SessionState): SessionEventType {
  switch (to) {
    case 'consented':
      return 'session.consented';
    case 'preflight':
      return 'session.preflight_passed';
    case 'live':
      return 'session.started';
    case 'completed':
      return 'session.completed';
    case 'abandoned':
      return 'session.abandoned';
    case 'invited':
      return 'session.recovered';
    default:
      return 'session.created';
  }
}
