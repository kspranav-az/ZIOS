/**
 * Practice consent copy v1 (X8 invariant). Plain English, recording + optional
 * model-improvement clauses. Owner review is a beta task; bump the version
 * constant (never edit in place) when the copy changes.
 */
export const PRACTICE_CONSENT_TEXT_VERSION = 'PRACTICE_CONSENT_TEXT_V1';

export const PRACTICE_CONSENT_TEXT = [
  'Before we start, please read and accept the following:',
  '',
  '1. This is a practice interview. An AI interviewer will ask questions and,',
  '   if you choose voice mode, your microphone audio will be processed live so',
  '   the interview can respond to you.',
  '2. Your answers are recorded as text, and in voice mode as audio, solely to',
  '   produce your practice report (scores, evidence, and coaching tips).',
  '3. Practice data belongs to your Ascend account. It is never shared with',
  '   employers and never appears in any employer product.',
  '4. You can delete your practice data at any time from your account.',
  '',
  'Optionally, you may also allow us to use anonymized transcripts to improve',
  'interview quality. This is off by default and never affects your report.',
].join('\n');
