import { Injectable } from '@nestjs/common';
import type {
  JdProfile,
  McqOption,
  ProposedQuestion,
  QuestionDifficulty,
  QuestionType,
  RubricLine,
} from '@zios/shared-types';
import { LlmGatewayPort } from './llm-gateway.port';

const SENIORITY_KEYWORDS = [
  { word: 'principal', level: 'principal' },
  { word: 'lead', level: 'lead' },
  { word: 'senior', level: 'senior' },
  { word: 'mid', level: 'mid' },
  { word: 'junior', level: 'junior' },
] as const;

const KNOWN_TOOLS = new Set([
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
  const labeled =
    extractLabeled(text, ['title', 'role', 'position']) ??
    extractLabeled(text, ['job title', 'role title']);
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
  for (const { word, level } of SENIORITY_KEYWORDS) {
    if (lower.includes(word)) return level;
  }
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
      // Capture any content that appears on the same line after the heading.
      const remainder = line
        .slice(matchedHeading.length)
        .replace(/^[:\-\s]+/, '')
        .trim();
      if (remainder.length > 0) {
        buffer.push(remainder);
      }
      continue;
    }
    if (inside) {
      // Stop at the next blank-line-separated capitalized heading heuristic.
      if (/^[A-Z][A-Za-z\s]{2,40}$/.test(line) && !line.includes(':')) {
        break;
      }
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
    // Split comma/semicolon separated entries inside one bullet.
    for (const part of cleaned.split(/[,;]/)) {
      const trimmed = part.trim();
      if (trimmed.length > 1) items.push(trimmed);
    }
  }
  return Array.from(new Set(items));
}

function extractSkills(text: string): string[] {
  const lines = sectionLines(text, [
    'skills',
    'must have',
    'must-have',
    'requirements',
    'required skills',
    'technical skills',
  ]);
  return parseList(lines);
}

function extractNiceToHaveSkills(text: string): string[] {
  const lines = sectionLines(text, ['nice to have', 'nice-to-have', 'preferred', 'bonus']);
  return parseList(lines);
}

function extractResponsibilities(text: string): string[] {
  const lines = sectionLines(text, [
    'responsibilities',
    'what you will do',
    "what you'll do",
    'role overview',
    'duties',
    'key responsibilities',
  ]);
  const parsed = parseList(lines);
  if (parsed.length > 0) return parsed;
  // Fallback: any bullet lines in the whole JD.
  return parseList(text.split('\n'));
}

function extractTools(skills: string[]): string[] {
  return skills.filter((skill) => KNOWN_TOOLS.has(skill.toLowerCase()));
}

function makeRubricLines(aspect: string): RubricLine[] {
  return [
    { id: 'r1', text: `Relevance to ${aspect}`, weight: 0.5 },
    { id: 'r2', text: 'Depth and specificity', weight: 0.3 },
    { id: 'r3', text: 'Clarity of communication', weight: 0.2 },
  ];
}

function makeMcqOptions(topic: string): McqOption[] {
  return [
    { id: 'a', text: `A robust, production-hardened ${topic} pattern`, correct: true },
    { id: 'b', text: `A convenient shortcut in ${topic}`, correct: false },
    { id: 'c', text: `An experimental ${topic} idea`, correct: false },
    { id: 'd', text: `A deprecated ${topic} practice`, correct: false },
  ];
}

function draftOpenEnded(topic: string, difficulty: QuestionDifficulty): ProposedQuestion {
  return {
    topic,
    type: 'open_ended',
    prompt: `Describe a concrete situation where you applied ${topic} to solve a meaningful problem. What was the context, what did you do, and what was the outcome?`,
    options: null,
    difficulty,
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'adaptive_ai',
    followupFixed: null,
    followupDepthCap: 2,
    rubricLines: makeRubricLines(topic),
    source: 'jd_generated',
    sourceRef: null,
  };
}

function draftMcqSingle(topic: string, difficulty: QuestionDifficulty): ProposedQuestion {
  return {
    topic,
    type: 'mcq_single',
    prompt: `Which of the following best describes a sound approach when working with ${topic}?`,
    options: makeMcqOptions(topic),
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
  };
}

function draftMcqMulti(topic: string, difficulty: QuestionDifficulty): ProposedQuestion {
  return {
    topic,
    type: 'mcq_multi',
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
  };
}

function draftRatingScale(topic: string): ProposedQuestion {
  return {
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
  };
}

/**
 * Deterministic stub LLM adapter for Phase 05. Parses structure heuristically
 * and drafts coherent (non-lorem-ipsum) questions with rubric lines.
 *
 * PDF/DOCX file extraction is intentionally out of scope for this phase;
 * callers must extract text before invoking the gateway.
 */
@Injectable()
export class StubLlmAdapter implements LlmGatewayPort {
  async analyzeJd(jdText: string): Promise<JdProfile> {
    const text = normalizeWhitespace(jdText);
    const title = extractTitle(text);
    const seniority = extractSeniority(text);
    const skills = extractSkills(text);
    const niceToHaveSkills = extractNiceToHaveSkills(text);
    const responsibilities = extractResponsibilities(text);
    const tools = extractTools(skills);
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

  async draftQuestions(
    _profile: JdProfile,
    topic: string,
    type: QuestionType,
    count: number,
  ): Promise<ProposedQuestion[]> {
    const questions: ProposedQuestion[] = [];
    for (let i = 0; i < count; i += 1) {
      const difficulty: QuestionDifficulty = i % 2 === 0 ? 'medium' : 'hard';
      switch (type) {
        case 'open_ended':
          questions.push(draftOpenEnded(topic, difficulty));
          break;
        case 'mcq_single':
          questions.push(draftMcqSingle(topic, difficulty));
          break;
        case 'mcq_multi':
          questions.push(draftMcqMulti(topic, difficulty));
          break;
        case 'rating_scale':
          questions.push(draftRatingScale(topic));
          break;
        default:
          questions.push(draftOpenEnded(topic, difficulty));
      }
    }
    return questions;
  }
}
