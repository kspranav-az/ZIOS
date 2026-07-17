import { describe, expect, it } from 'vitest';
import type { InterviewSession, KitSnapshot, SessionTranscript } from '@zios/shared-types';
import { StubConductorAdapter } from './stub-conductor.adapter';

function snapshot(questions: KitSnapshot['questions'], outroText?: string): KitSnapshot {
  return {
    schemaVersion: 1,
    kit: {
      id: 'kit-1',
      title: 'Test Kit',
      role: null,
      level: null,
      settings: {
        mode: 'text',
        language: 'en',
        proctoringLevel: 'none',
        introText: null,
        outroText: outroText ?? null,
        logoUrl: null,
        totalTimeCapSec: 1800,
      },
      jdRef: null,
    },
    questions,
    durationEstimateSec: 120,
  };
}

function session(): InterviewSession {
  return {
    id: 'session-1',
    inviteId: 'invite-1',
    kitVersionId: 'kv-1',
    mode: 'text',
    conductor: 'ai',
    status: 'live',
    consentId: 'consent-1',
    preflightReport: {},
    startedAt: new Date().toISOString(),
    endedAt: null,
    mediaRefs: [],
    integrityEvents: [],
    schemaVersion: 1,
    recoveryTokenHash: 'hash',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('StubConductorAdapter', () => {
  const conductor = new StubConductorAdapter();

  it('asks the first question initially', () => {
    const snap = snapshot([
      { id: 'q1', prompt: 'Question one', followupPolicy: 'none' } as unknown,
    ] as KitSnapshot['questions']);
    const turn = conductor.nextTurn({ session: session(), snapshot: snap, transcript: [] });
    expect(turn.type).toBe('question');
    expect(turn.text).toBe('Question one');
    expect(turn.questionId).toBe('q1');
  });

  it('asks all mandatory questions in order, one at a time', () => {
    const snap = snapshot([
      { id: 'q1', prompt: 'Q1', followupPolicy: 'none' } as unknown,
      { id: 'q2', prompt: 'Q2', followupPolicy: 'none' } as unknown,
      { id: 'q3', prompt: 'Q3', followupPolicy: 'none' } as unknown,
    ] as KitSnapshot['questions']);

    const transcript: SessionTranscript[] = [];
    const turn1 = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(turn1.questionId).toBe('q1');

    transcript.push({
      id: 't1',
      sessionId: 'session-1',
      questionId: 'q1',
      questionPrompt: 'Q1',
      answerText: 'answer 1',
      position: 0,
      evidenceSpan: [],
      createdAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    } as SessionTranscript);

    const turn2 = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(turn2.questionId).toBe('q2');

    transcript.push({
      id: 't2',
      sessionId: 'session-1',
      questionId: 'q2',
      questionPrompt: 'Q2',
      answerText: 'answer 2',
      position: 1,
      evidenceSpan: [],
      createdAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    } as SessionTranscript);

    const turn3 = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(turn3.questionId).toBe('q3');
  });

  it('asks one fixed follow-up at depth 1', () => {
    const snap = snapshot([
      {
        id: 'q1',
        prompt: 'Q1',
        followupPolicy: 'fixed',
        followupFixed: ['Tell me more'],
      } as unknown,
    ] as KitSnapshot['questions']);

    const transcript: SessionTranscript[] = [];
    const q1 = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(q1.type).toBe('question');

    transcript.push({
      id: 't1',
      sessionId: 'session-1',
      questionId: 'q1',
      questionPrompt: 'Q1',
      answerText: 'ans',
      position: 0,
      evidenceSpan: [],
      createdAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    } as SessionTranscript);

    const followup = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(followup.type).toBe('followup');
    expect(followup.text).toBe('Tell me more');

    transcript.push({
      id: 't2',
      sessionId: 'session-1',
      questionId: 'q1',
      questionPrompt: 'Tell me more',
      answerText: 'more',
      position: 1,
      evidenceSpan: [],
      createdAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    } as SessionTranscript);

    const wrapup = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(wrapup.type).toBe('wrapup');
  });

  it('wraps up with the kit outro', () => {
    const snap = snapshot(
      [{ id: 'q1', prompt: 'Q1', followupPolicy: 'none' } as unknown] as KitSnapshot['questions'],
      'Goodbye and good luck',
    );
    const transcript = [
      {
        id: 't1',
        sessionId: 'session-1',
        questionId: 'q1',
        questionPrompt: 'Q1',
        answerText: 'ans',
        position: 0,
        evidenceSpan: [],
        createdAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      } as SessionTranscript,
    ];
    const turn = conductor.nextTurn({ session: session(), snapshot: snap, transcript });
    expect(turn.type).toBe('wrapup');
    expect(turn.text).toBe('Goodbye and good luck');
  });
});
