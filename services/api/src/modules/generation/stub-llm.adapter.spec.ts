import { describe, expect, it } from 'vitest';
import { StubLlmAdapter } from './stub-llm.adapter';

const SAMPLE_JD = `
Title: Senior Backend Engineer

We are building the platform that powers AI-led interviews.

Responsibilities:
- Design and ship scalable APIs
- Mentor junior engineers
- Review system designs

Requirements / Skills:
- Python, PostgreSQL, Redis
- Strong communication
- 5+ years of backend experience
`;

describe('StubLlmAdapter', () => {
  const adapter = new StubLlmAdapter();

  it('extracts title, seniority, skills, and responsibilities from a known JD', async () => {
    const profile = await adapter.analyzeJd(SAMPLE_JD);
    expect(profile.title).toBe('Senior Backend Engineer');
    expect(profile.seniority).toBe('senior');
    expect(profile.skills).toContain('Python');
    expect(profile.skills).toContain('PostgreSQL');
    expect(profile.skills).toContain('Redis');
    expect(profile.skills).toContain('Strong communication');
    expect(profile.responsibilities.length).toBeGreaterThanOrEqual(3);
    expect(profile.responsibilities.some((r) => r.toLowerCase().includes('api'))).toBe(true);
  });

  it('falls back to the first non-empty line when no label is present', async () => {
    const profile = await adapter.analyzeJd('Lead Frontend Developer\n\nSkills: React, TypeScript');
    expect(profile.title).toBe('Lead Frontend Developer');
    expect(profile.seniority).toBe('lead');
    expect(profile.skills).toContain('React');
    expect(profile.skills).toContain('TypeScript');
  });

  it('drafts coherent open-ended questions with rubric lines', async () => {
    const profile = await adapter.analyzeJd(SAMPLE_JD);
    const questions = await adapter.draftQuestions(profile, 'Python', 'open_ended', 2);
    expect(questions).toHaveLength(2);
    for (const question of questions) {
      expect(question.topic).toBe('Python');
      expect(question.type).toBe('open_ended');
      expect(question.prompt.length).toBeGreaterThan(20);
      expect(question.rubricLines.length).toBeGreaterThan(0);
      const sum = question.rubricLines.reduce((acc, line) => acc + line.weight, 0);
      expect(sum).toBeCloseTo(1, 2);
    }
  });

  it('drafts MCQ options for technical topics', async () => {
    const profile = await adapter.analyzeJd(SAMPLE_JD);
    const questions = await adapter.draftQuestions(profile, 'PostgreSQL', 'mcq_single', 1);
    expect(questions).toHaveLength(1);
    const question = questions[0]!;
    expect(question.type).toBe('mcq_single');
    expect(question.options?.length).toBeGreaterThanOrEqual(2);
    expect(question.options?.every((o) => typeof o.text === 'string' && o.text.length > 0)).toBe(
      true,
    );
  });
});
