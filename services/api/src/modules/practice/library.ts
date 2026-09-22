import type { KitQuestion, PracticeLibraryPack, RubricLine } from '@zios/shared-types';

/**
 * Built-in starter question packs (Phase 12, Branch 2). Seeded JSON — no LLM
 * involved for source='library' sessions. Content review is an owner task
 * before open beta; v1 copy is intentionally conservative and
 * interviewer-neutral.
 */

function line(id: string, text: string, weight: number): RubricLine {
  return { id, text, weight };
}

function question(
  packId: string,
  index: number,
  prompt: string,
  rubricLines: RubricLine[],
): KitQuestion {
  const id = `${packId}-q${index}`;
  const now = '2026-09-23T00:00:00.000Z';
  return {
    id,
    kitId: `library-${packId}`,
    topic: 'Practice',
    position: String(index),
    type: 'open_ended',
    prompt,
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'adaptive_ai',
    followupFixed: null,
    followupDepthCap: 2,
    rubricLines,
    source: 'manual',
    sourceRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const PRACTICE_LIBRARY_PACKS: PracticeLibraryPack[] = [
  {
    id: 'hr-screening',
    title: 'HR Screening Basics',
    description: 'Classic HR round — motivation, fit, and self-awareness.',
    questions: [
      question('hr-screening', 1, 'Tell me about yourself and what you are looking for next.', [
        line('hr1-a', 'Structure: clear beginning, relevant experience, and intent', 0.5),
        line('hr1-b', 'Specifics: concrete examples instead of generic claims', 0.5),
      ]),
      question('hr-screening', 2, 'Why do you want to work at our company?', [
        line('hr2-a', 'Research: references something specific about the company', 0.5),
        line('hr2-b', 'Alignment: connects their goals to what the company does', 0.5),
      ]),
      question('hr-screening', 3, 'What is your greatest strength, and how have you used it?', [
        line('hr3-a', 'Evidence: a concrete situation showing the strength in action', 0.5),
        line('hr3-b', 'Honesty: calibrated claim, not a superlative list', 0.5),
      ]),
      question('hr-screening', 4, 'Tell me about a conflict you had with a teammate and how you resolved it.', [
        line('hr4-a', 'STAR completeness: situation, task, action, result', 0.5),
        line('hr4-b', 'Ownership: acknowledges their own part in the conflict', 0.5),
      ]),
    ],
  },
  {
    id: 'behavioral-core',
    title: 'Behavioral — Core Four',
    description: 'The four behavioral questions that decide most loops.',
    questions: [
      question('behavioral-core', 1, 'Tell me about a time you missed a deadline. What happened?', [
        line('b1-a', 'Accountability: owns the miss without deflecting', 0.5),
        line('b1-b', 'Learning: describes a concrete change afterwards', 0.5),
      ]),
      question('behavioral-core', 2, 'Describe a project you are most proud of and your specific contribution.', [
        line('b2-a', 'Specificity: their personal role is separable from the team', 0.5),
        line('b2-b', 'Impact: quantified or verifiable outcome', 0.5),
      ]),
      question('behavioral-core', 3, 'Tell me about a time you received hard feedback. How did you respond?', [
        line('b3-a', 'Reception: non-defensive description of the moment', 0.5),
        line('b3-b', 'Action: shows the feedback changed behavior', 0.5),
      ]),
      question('behavioral-core', 4, 'Describe a situation where you had to learn something new quickly.', [
        line('b4-a', 'Method: explains how they decomposed the learning', 0.5),
        line('b4-b', 'Outcome: demonstrates the skill was actually applied', 0.5),
      ]),
    ],
  },
  {
    id: 'technical-general',
    title: 'Technical — General',
    description: 'System thinking and trade-offs, language-agnostic.',
    questions: [
      question('technical-general', 1, 'Explain a system you built end-to-end. What were the key design decisions?', [
        line('t1-a', 'Architecture: components, data flow, and boundaries are clear', 0.5),
        line('t1-b', 'Trade-offs: names alternatives considered and why rejected', 0.5),
      ]),
      question('technical-general', 2, 'How would you design a URL shortener?', [
        line('t2-a', 'Requirements: asks or states scale assumptions', 0.5),
        line('t2-b', 'Data model: identifier scheme, storage, and collisions addressed', 0.5),
      ]),
      question('technical-general', 3, 'Tell me about the hardest bug you have debugged.', [
        line('t3-a', 'Process: systematic narrowing instead of guessing', 0.5),
        line('t3-b', 'Root cause: explains the actual failure, not just the fix', 0.5),
      ]),
      question('technical-general', 4, 'How do you approach reviewing someone else\'s code?', [
        line('t4-a', 'Prioritization: correctness and clarity before style', 0.5),
        line('t4-b', 'Communication: feedback framed as questions where possible', 0.5),
      ]),
    ],
  },
];

export function findPack(packId: string): PracticeLibraryPack | null {
  return PRACTICE_LIBRARY_PACKS.find((pack) => pack.id === packId) ?? null;
}
