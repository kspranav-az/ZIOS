import { Injectable } from '@nestjs/common';
import type {
  JdProfile,
  ProposedQuestion,
  SessionTranscript,
  SessionTurnResponse,
} from '@zios/shared-types';
import type { JudgeEvidenceSpan, LlmProvider } from './contracts';

type JudgeScore = {
  questionId: string;
  criterionId: string;
  criterionText: string;
  score: number;
  weight: number;
  evidenceSpan: JudgeEvidenceSpan;
};

type JudgeMetrics = {
  paceWpm: number;
  fillerCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
};

type JudgeResult = {
  scores: JudgeScore[];
  metrics: JudgeMetrics;
  recommendation: number;
  confidence: number;
};

interface FixtureRegistry {
  analyze_jd: (variables: Record<string, unknown>) => JdProfile;
  draft_questions: (variables: Record<string, unknown>) => ProposedQuestion[];
  conductor_next_turn: (variables: Record<string, unknown>) => SessionTurnResponse;
  judge_score: (variables: Record<string, unknown>) => JudgeResult;
  judge_adjudicate: (variables: Record<string, unknown>) => JudgeResult & { rationale: string };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractLabeled(text: string, labels: string[]): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.join('|')})[:\\-\\s]+(?!\\s*\\n)([^\\n]+)`,
    'i',
  );
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? null;
}

function extractTitle(text: string): string | null {
  const labeled = extractLabeled(text, ['title', 'role', 'position', 'job title', 'role title']);
  if (labeled) return labeled;
  const lines = text.split('\n').map((line) => line.trim());
  for (const line of lines) {
    if (line.length > 0 && line.length < 120 && !line.startsWith('-') && !line.startsWith('•')) {
      return line;
    }
  }
  return null;
}

function extractSeniority(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('principal')) return 'principal';
  if (lower.includes('lead')) return 'lead';
  if (lower.includes('senior')) return 'senior';
  if (lower.includes('mid')) return 'mid';
  if (lower.includes('junior')) return 'junior';
  return null;
}

function sectionLines(text: string, headings: string[]): string[] {
  const lines = text.split('\n');
  let inside = false;
  const buffer: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const matchedHeading = headings.find((h) => line.toLowerCase().startsWith(h.toLowerCase()));
    if (matchedHeading) {
      inside = true;
      const remainder = line
        .slice(matchedHeading.length)
        .replace(/^[:\-\s]+/, '')
        .trim();
      if (remainder.length > 0) buffer.push(remainder);
      continue;
    }
    if (inside) {
      if (/^[A-Z][A-Za-z\s]{2,40}$/.test(line) && !line.includes(':')) break;
      buffer.push(line);
    }
  }
  return buffer;
}

function parseList(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/^[-•*]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    if (cleaned.length === 0) continue;
    for (const part of cleaned.split(/[,;]/)) {
      const trimmed = part.trim();
      if (trimmed.length > 1) items.push(trimmed);
    }
  }
  return Array.from(new Set(items));
}

function analyzeJdFixture(variables: Record<string, unknown>): JdProfile {
  const text = normalizeWhitespace(String(variables.jdText ?? ''));
  const title = extractTitle(text);
  const seniority = extractSeniority(text);
  const skills = parseList(
    sectionLines(text, [
      'skills',
      'must have',
      'must-have',
      'requirements',
      'required skills',
      'technical skills',
    ]),
  );
  const responsibilities = parseList(
    sectionLines(text, [
      'responsibilities',
      'what you will do',
      "what you'll do",
      'role overview',
      'duties',
      'key responsibilities',
    ]),
  );
  const niceToHaveSkills = parseList(
    sectionLines(text, ['nice to have', 'nice-to-have', 'preferred', 'bonus']),
  );
  const knownTools = new Set([
    'python',
    'javascript',
    'typescript',
    'java',
    'go',
    'rust',
    'node.js',
    'nodejs',
    'react',
    'angular',
    'vue',
    'postgres',
    'postgresql',
    'mysql',
    'mongodb',
    'redis',
    'kafka',
    'aws',
    'gcp',
    'azure',
    'docker',
    'kubernetes',
    'terraform',
    'git',
  ]);
  const tools = skills.filter((skill) => knownTools.has(skill.toLowerCase()));
  return {
    title,
    seniority,
    roleFamily: title?.split(' ').pop()?.toLowerCase() ?? null,
    skills,
    niceToHaveSkills,
    responsibilities,
    tools,
    languages: [],
    raw: {
      titleSource: title === text.split('\n')[0]?.trim() ? 'first_line' : 'labeled',
      senioritySource: seniority ? 'keyword' : null,
    },
  };
}

function draftQuestionsFixture(variables: Record<string, unknown>): ProposedQuestion[] {
  const topic = String(variables.topic ?? 'General');
  const type = String(variables.type ?? 'open_ended') as ProposedQuestion['type'];
  const count = Math.max(1, Math.min(10, Number(variables.count ?? 1)));
  const rubricLines = [
    { id: 'r1', text: `Relevance to ${topic}`, weight: 0.5 },
    { id: 'r2', text: 'Depth and specificity', weight: 0.3 },
    { id: 'r3', text: 'Clarity of communication', weight: 0.2 },
  ];

  const questions: ProposedQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const difficulty: ProposedQuestion['difficulty'] = i % 2 === 0 ? 'medium' : 'hard';
    if (type === 'open_ended') {
      questions.push({
        topic,
        type,
        prompt: `Describe a concrete situation where you applied ${topic} to solve a meaningful problem. What was the context, what did you do, and what was the outcome?`,
        options: null,
        difficulty,
        timeLimitSec: 120,
        timeLimitType: 'soft',
        mandatory: true,
        followupPolicy: 'adaptive_ai',
        followupFixed: null,
        followupDepthCap: 2,
        rubricLines,
        source: 'jd_generated',
        sourceRef: null,
      });
    } else if (type === 'mcq_single') {
      questions.push({
        topic,
        type,
        prompt: `Which of the following best describes a sound approach when working with ${topic}?`,
        options: [
          { id: 'a', text: `A robust, production-hardened ${topic} pattern`, correct: true },
          { id: 'b', text: `A convenient shortcut in ${topic}`, correct: false },
          { id: 'c', text: `An experimental ${topic} idea`, correct: false },
          { id: 'd', text: `A deprecated ${topic} practice`, correct: false },
        ],
        difficulty,
        timeLimitSec: 90,
        timeLimitType: 'soft',
        mandatory: true,
        followupPolicy: 'none',
        followupFixed: null,
        followupDepthCap: null,
        rubricLines: [
          { id: 'r1', text: 'Selects the correct option', weight: 0.7 },
          { id: 'r2', text: 'Demonstrates conceptual understanding', weight: 0.3 },
        ],
        source: 'jd_generated',
        sourceRef: null,
      });
    } else if (type === 'mcq_multi') {
      questions.push({
        topic,
        type,
        prompt: `Select all practices that are important when using ${topic} in a production system.`,
        options: [
          { id: 'a', text: `Monitoring and observability for ${topic}`, correct: true },
          { id: 'b', text: `Automated testing around ${topic}`, correct: true },
          { id: 'c', text: `Hard-coding environment-specific ${topic} values`, correct: false },
          { id: 'd', text: `Documenting ${topic} decisions`, correct: true },
        ],
        difficulty,
        timeLimitSec: 90,
        timeLimitType: 'soft',
        mandatory: true,
        followupPolicy: 'none',
        followupFixed: null,
        followupDepthCap: null,
        rubricLines: [
          { id: 'r1', text: 'Selects all correct options', weight: 0.6 },
          { id: 'r2', text: 'Avoids incorrect options', weight: 0.4 },
        ],
        source: 'jd_generated',
        sourceRef: null,
      });
    } else {
      questions.push({
        topic,
        type: 'rating_scale',
        prompt: `Rate your hands-on experience level with ${topic}.`,
        options: null,
        difficulty: 'easy',
        timeLimitSec: 60,
        timeLimitType: 'soft',
        mandatory: true,
        followupPolicy: 'none',
        followupFixed: null,
        followupDepthCap: null,
        rubricLines: [
          { id: 'r1', text: 'Self-assessment is consistent with later answers', weight: 1 },
        ],
        source: 'jd_generated',
        sourceRef: null,
      });
    }
  }
  return questions;
}

function findNextQuestion(
  questions: {
    id: string;
    prompt: string;
    followupPolicy: string;
    followupFixed?: string[] | null;
  }[],
  transcript: SessionTranscript[],
): { question: (typeof questions)[0]; isFollowup: boolean; followupText?: string } | null {
  const asked = new Map<string, number>();
  for (const row of transcript) {
    asked.set(row.questionId, (asked.get(row.questionId) ?? 0) + 1);
  }
  const answered = new Map<string, number>();
  for (const row of transcript) {
    if (row.answerText !== null) {
      answered.set(row.questionId, (answered.get(row.questionId) ?? 0) + 1);
    }
  }
  for (const question of questions) {
    const askCount = asked.get(question.id) ?? 0;
    const answeredCount = answered.get(question.id) ?? 0;
    const fixedFollowups =
      question.followupPolicy === 'fixed' ? (question.followupFixed ?? []) : [];
    const totalSlots = 1 + fixedFollowups.length;
    if (answeredCount < totalSlots) {
      if (askCount === 0) {
        return { question, isFollowup: false };
      }
      const followupIndex = askCount - 1;
      if (followupIndex < fixedFollowups.length) {
        return { question, isFollowup: true, followupText: fixedFollowups[followupIndex] };
      }
    }
  }
  return null;
}

function conductorNextTurnFixture(variables: Record<string, unknown>): SessionTurnResponse {
  const transcript = (variables.transcript ?? []) as SessionTranscript[];
  const questions = (variables.questions ?? []) as {
    id: string;
    prompt: string;
    followupPolicy: string;
    followupFixed?: string[] | null;
  }[];
  const next = findNextQuestion(questions, transcript);
  if (!next) {
    return {
      type: 'wrapup',
      text: "Thank you for completing the interview. We'll share the next steps with the hiring team.",
      questionId: null,
    };
  }
  if (next.isFollowup && next.followupText) {
    return { type: 'followup', text: next.followupText, questionId: next.question.id };
  }
  return { type: 'question', text: next.question.prompt, questionId: next.question.id };
}

function computeMetrics(transcript: SessionTranscript[]) {
  const answered = transcript.filter((row) => row.answerText && row.answerText.length > 0);
  const totalWords = answered.reduce(
    (sum, row) => sum + (row.answerText?.split(/\s+/).length ?? 0),
    0,
  );
  const durationMinutes = Math.max(1, answered.length);
  const paceWpm = Math.round(totalWords / durationMinutes);
  const fillerCount = answered.reduce(
    (sum, row) => sum + ((row.answerText ?? '').match(/\b(um|uh|like)\b/gi) ?? []).length,
    0,
  );
  const paragraphCount = answered.reduce(
    (sum, row) => sum + ((row.answerText ?? '').split(/\n\s*\n/).length ?? 0),
    0,
  );
  const avgSentenceLength =
    answered.length > 0
      ? Math.round(
          totalWords /
            Math.max(
              1,
              answered.reduce(
                (sum, row) => sum + ((row.answerText ?? '').match(/[^.!?]+[.!?]+/g) ?? []).length,
                0,
              ),
            ),
        )
      : 0;
  return { paceWpm, fillerCount, paragraphCount, avgSentenceLength };
}

function judgeScoreFixture(variables: Record<string, unknown>): JudgeResult {
  const transcript = (variables.transcript ?? []) as SessionTranscript[];
  const questions = (variables.questions ?? []) as {
    id: string;
    rubricLines: { id: string; text: string; weight: number }[];
  }[];
  const metrics = computeMetrics(transcript);
  const scores = questions.flatMap((question) => {
    const rows = transcript.filter((row) => row.questionId === question.id);
    const combined = rows.map((row) => row.answerText ?? '').join(' ');
    const len = combined.length;
    const fillerHits = (combined.match(/\b(um|uh|like)\b/gi) ?? []).length;
    const fillerDensity = len > 0 ? fillerHits / len : 0;
    let score = 1;
    if (len > 200 && fillerDensity <= 0.05) score = 5;
    else if (len > 100) score = 4;
    else if (len > 30) score = 3;
    else if (len > 0) score = 2;

    const firstRow = rows.find((row) => (row.answerText?.length ?? 0) > 0) ?? rows[0];
    const answer = firstRow?.answerText ?? '';
    const end = Math.min(80, answer.length);
    return question.rubricLines.map((line) => ({
      questionId: question.id,
      criterionId: line.id,
      criterionText: line.text,
      score,
      weight: line.weight,
      evidenceSpan: {
        transcriptId: firstRow?.id ?? null,
        questionId: question.id,
        start: 0,
        end,
        quoteText: answer.slice(0, end),
      },
    }));
  });

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
  const raw = totalWeight > 0 ? weightedSum / totalWeight : 3;
  let confidence = 0.9;
  if (metrics.paceWpm > 180) confidence -= 0.15;
  if (metrics.paceWpm < 40) confidence -= 0.1;
  if (metrics.fillerCount > 5) confidence -= 0.1;
  confidence = Math.max(0.5, Math.min(0.99, confidence));
  const recommendation = Math.max(1, Math.min(5, Math.round(raw)));
  return { scores, metrics, recommendation, confidence };
}

function judgeAdjudicateFixture(
  variables: Record<string, unknown>,
): JudgeResult & { rationale: string } {
  const a = judgeScoreFixture(variables.judgeA as Record<string, unknown>);
  const b = judgeScoreFixture(variables.judgeB as Record<string, unknown>);
  const result = { ...a };
  // Simple adjudication: average the two scores and lower confidence.
  for (let i = 0; i < result.scores.length; i += 1) {
    const scoreA = a.scores[i]?.score ?? 0;
    const scoreB = b.scores[i]?.score ?? 0;
    result.scores[i]!.score = Math.round((scoreA + scoreB) / 2);
  }
  result.confidence = Math.max(0.5, result.confidence - 0.1);
  return { ...result, rationale: 'Averaged scores from two disagreeing judges.' };
}

const FIXTURES: FixtureRegistry = {
  analyze_jd: analyzeJdFixture,
  draft_questions: draftQuestionsFixture,
  conductor_next_turn: conductorNextTurnFixture,
  judge_score: judgeScoreFixture,
  judge_adjudicate: judgeAdjudicateFixture,
};

/**
 * Fixture-driven mock LLM provider. It ignores the rendered prompt and returns
 * deterministic JSON output based on the task name, which lets the gateway
 * routing/fallback/budget machinery run while keeping tests hermetic.
 */
@Injectable()
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-fixture-model';
  readonly costPer1kInput = 0.001;
  readonly costPer1kOutput = 0.002;

  async complete(input: {
    task: string;
    promptText: string;
    variables: Record<string, unknown>;
  }): Promise<{ text: string; tokensIn: number; tokensOut: number; model?: string }> {
    const { task, promptText, variables } = input;
    const fixture = FIXTURES[task as keyof FixtureRegistry];
    if (!fixture) {
      throw new Error(`MockLlmProvider: no fixture for task ${task}`);
    }
    const output = fixture(variables);
    const text = JSON.stringify(output);
    // Estimate tokens as ~4 chars per token.
    const tokensIn = Math.ceil(promptText.length / 4);
    const tokensOut = Math.ceil(text.length / 4);
    return { text, tokensIn, tokensOut, model: this.defaultModel };
  }
}
