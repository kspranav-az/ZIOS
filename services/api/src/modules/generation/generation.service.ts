import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AppUser,
  GenerationProposal,
  JdGeneration,
  JdProfile,
  KitSettings,
  KitVersionSummary,
  ProposalEdit,
  ProposedQuestion,
  QuestionBankItem,
  QuestionType,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { estimateDuration, KitsService } from '@/modules/kits';
import {
  EXTERNAL_QUESTION_SOURCE_PORT,
  ExternalQuestionSourcePort,
} from './external-question-source.port';
import { GenerationRepository } from './generation.repository';
import { LLM_GATEWAY_PORT, LlmGatewayPort } from './llm-gateway.port';

const DEFAULT_CAP_SEC = 1800;
const TARGET_MIN_QUESTIONS = 8;
const TARGET_MAX_QUESTIONS = 15;
const QUESTION_TIME_LIMIT_SEC = 120;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function emptyProfile(): JdProfile {
  return {
    title: null,
    seniority: null,
    roleFamily: null,
    skills: [],
    niceToHaveSkills: [],
    responsibilities: [],
    tools: [],
    languages: [],
    raw: {},
  };
}

function emptyProposal(): GenerationProposal {
  return { topics: [], questions: [], durationEstimateSec: 0, withinCap: true };
}

function normalizeRubricLines(lines: { id: string; text: string; weight: number }[]): {
  id: string;
  text: string;
  weight: number;
}[] {
  if (lines.length === 0) {
    return [{ id: 'r1', text: 'Answer quality', weight: 1 }];
  }
  const valid = lines.filter(
    (line) => typeof line.text === 'string' && line.text.trim().length > 0,
  );
  const sum = valid.reduce((acc, line) => acc + line.weight, 0);
  if (sum <= 0) {
    return valid.map((line, index) => ({ ...line, weight: index === 0 ? 1 : 0 }));
  }
  return valid.map((line, index) => ({
    id: line.id || `r${index + 1}`,
    text: line.text,
    weight: Number((line.weight / sum).toFixed(4)),
  }));
}

function bankItemToProposedQuestion(item: QuestionBankItem, topic: string): ProposedQuestion {
  return {
    topic,
    type: item.type,
    prompt: item.prompt,
    options: item.options,
    difficulty: item.difficulty,
    timeLimitSec: QUESTION_TIME_LIMIT_SEC,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: item.type === 'open_ended' ? 'adaptive_ai' : 'none',
    followupFixed: null,
    followupDepthCap: item.type === 'open_ended' ? 2 : null,
    rubricLines: normalizeRubricLines(item.rubricLines),
    source: 'jd_generated',
    sourceRef: null,
  };
}

function deriveTopics(profile: JdProfile): string[] {
  const candidates: string[] = [];
  for (const skill of profile.skills) {
    candidates.push(skill);
  }
  for (const responsibility of profile.responsibilities.slice(0, 8)) {
    const short = responsibility.split(/[,;]/)[0] ?? responsibility;
    const words = short.trim().split(/\s+/).slice(0, 4).join(' ');
    if (words.length > 2) candidates.push(words);
  }
  const unique = Array.from(new Set(candidates.map((c) => c.trim()).filter((c) => c.length > 0)));
  const fallbacks = [
    'Behavioral',
    'Situational judgment',
    'Culture fit',
    'Role overview',
    'Communication',
  ];
  while (unique.length < 4 && fallbacks.length > 0) {
    const next = fallbacks.shift();
    if (next && !unique.includes(next)) unique.push(next);
  }
  return unique.slice(0, 8);
}

@Injectable()
export class GenerationService {
  constructor(
    @Inject(LLM_GATEWAY_PORT) private readonly llm: LlmGatewayPort,
    @Inject(EXTERNAL_QUESTION_SOURCE_PORT) private readonly external: ExternalQuestionSourcePort,
    private readonly repository: GenerationRepository,
    private readonly kits: KitsService,
  ) {}

  private capSeconds(): number {
    return DEFAULT_CAP_SEC;
  }

  async analyze(orgId: string, jdText: string): Promise<JdProfile> {
    this.assertValidJdText(jdText);
    return this.llm.analyzeJd(jdText);
  }

  async getGeneration(orgId: string, generationId: string): Promise<JdGeneration> {
    const generation = await this.repository.findById(orgId, generationId);
    if (!generation) {
      throw new ApiException(404, 'GENERATION_NOT_FOUND', 'generation not found');
    }
    return generation;
  }

  async analyzeAndPropose(orgId: string, jdText: string): Promise<JdGeneration> {
    this.assertValidJdText(jdText);
    const jdHash = sha256(jdText);

    const analyzing = await this.repository.insert({
      orgId,
      jdHash,
      promptVersion: 'phase05-stub',
      status: 'analyzing',
      roleProfile: emptyProfile(),
      proposal: emptyProposal(),
      edits: [],
    });

    try {
      const profile = await this.llm.analyzeJd(jdText);
      const proposal = await this.buildProposal(orgId, profile);
      const updated = await this.repository.update(orgId, analyzing.id, {
        status: 'proposed',
        roleProfile: profile,
        proposal,
        edits: [],
      });
      if (!updated) {
        throw new ApiException(
          404,
          'GENERATION_NOT_FOUND',
          'generation record disappeared during analysis',
        );
      }
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.update(orgId, analyzing.id, {
        status: 'failed',
        errorMessage: message,
      });
      throw error;
    }
  }

  async publishProposal(
    user: AppUser,
    generationId: string,
    finalProposal?: GenerationProposal,
    edits?: ProposalEdit[],
    settingsOverrides?: Partial<KitSettings>,
  ): Promise<{ generation: JdGeneration; version: KitVersionSummary }> {
    const generation = await this.repository.findById(user.orgId, generationId);
    if (!generation) {
      throw new ApiException(404, 'GENERATION_NOT_FOUND', 'generation not found');
    }
    if (generation.status !== 'proposed') {
      throw new ApiException(
        409,
        'GENERATION_NOT_PROPOSED',
        `cannot publish a generation with status ${generation.status}`,
      );
    }

    const proposal = finalProposal ?? generation.proposal;

    const generationMetadata: Record<string, unknown> = {
      jdHash: generation.jdHash,
      promptVersion: generation.promptVersion,
      generatedAt: generation.createdAt,
      publishedAt: new Date().toISOString(),
    };

    const { kit, version } = await this.kits.createFromProposal(
      user,
      proposal,
      generation.roleProfile,
      generation.id,
      generationMetadata,
      settingsOverrides,
    );

    const updated = await this.repository.update(user.orgId, generationId, {
      status: 'published',
      kitId: kit.id,
      edits: (edits as unknown[]) ?? generation.edits,
    });
    if (!updated) {
      throw new ApiException(
        404,
        'GENERATION_NOT_FOUND',
        'generation record disappeared during publish',
      );
    }

    return { generation: updated, version };
  }

  async regenerateQuestion(
    orgId: string,
    generationId: string,
    index: number,
    constraints?: { topic?: string; type?: QuestionType },
  ): Promise<JdGeneration> {
    const generation = await this.repository.findById(orgId, generationId);
    if (!generation) {
      throw new ApiException(404, 'GENERATION_NOT_FOUND', 'generation not found');
    }
    if (generation.status !== 'proposed') {
      throw new ApiException(
        409,
        'GENERATION_NOT_PROPOSED',
        `cannot edit a generation with status ${generation.status}`,
      );
    }
    const questions = generation.proposal.questions;
    if (index < 0 || index >= questions.length) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        `index must be between 0 and ${questions.length - 1}`,
      );
    }

    const original = questions[index]!;
    const topic = constraints?.topic ?? original.topic;
    const type = constraints?.type ?? original.type;
    const replacements = await this.llm.draftQuestions(generation.roleProfile, topic, type, 1);
    if (replacements.length === 0) {
      throw new ApiException(
        500,
        'GENERATION_FAILED',
        'draft adapter returned no replacement question',
      );
    }
    const replacement = replacements[0]!;
    const newQuestions = [...questions];
    newQuestions[index] = { ...replacement, topic, type };

    const proposal = this.finalizeProposal(newQuestions);
    const updated = await this.repository.update(orgId, generationId, { proposal });
    if (!updated) {
      throw new ApiException(
        404,
        'GENERATION_NOT_FOUND',
        'generation record disappeared during regeneration',
      );
    }
    return updated;
  }

  private assertValidJdText(jdText: string): void {
    if (typeof jdText !== 'string' || jdText.trim().length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'jdText is required');
    }
  }

  private async buildProposal(orgId: string, profile: JdProfile): Promise<GenerationProposal> {
    const topics = deriveTopics(profile);
    const questions: ProposedQuestion[] = [];

    for (const topic of topics) {
      const bankItems = await this.external.search(orgId, topic);
      const bankQuestions = bankItems
        .slice(0, 1)
        .map((item) => bankItemToProposedQuestion(item, topic));
      questions.push(...bankQuestions);

      const drafted = await this.llm.draftQuestions(profile, topic, 'open_ended', 1);
      questions.push(...drafted);
    }

    if (questions.length < TARGET_MIN_QUESTIONS) {
      const extrasNeeded = TARGET_MIN_QUESTIONS - questions.length;
      for (let i = 0; i < extrasNeeded; i += 1) {
        const topic = topics[i % topics.length] ?? 'General';
        const type: QuestionType = i % 3 === 0 ? 'rating_scale' : 'open_ended';
        const drafted = await this.llm.draftQuestions(profile, topic, type, 1);
        questions.push(...drafted);
      }
    }

    if (questions.length > TARGET_MAX_QUESTIONS) {
      questions.splice(TARGET_MAX_QUESTIONS);
    }

    return this.finalizeProposal(questions);
  }

  private finalizeProposal(questions: ProposedQuestion[]): GenerationProposal {
    // Enforce the duration cap by dropping lowest-priority questions from the
    // tail (topics are ordered by priority: skills first, responsibilities next,
    // fallbacks last).
    const cap = this.capSeconds();
    let estimate = estimateDuration(
      questions.map((q) => ({ id: q.prompt, timeLimitSec: q.timeLimitSec })),
    );
    while (questions.length > TARGET_MIN_QUESTIONS && estimate.estimatedSeconds > cap) {
      questions.pop();
      estimate = estimateDuration(
        questions.map((q) => ({ id: q.prompt, timeLimitSec: q.timeLimitSec })),
      );
    }

    const topics = Array.from(new Set(questions.map((q) => q.topic)));
    return {
      topics,
      questions: questions.map((q) => ({
        ...q,
        rubricLines: normalizeRubricLines(q.rubricLines),
      })),
      durationEstimateSec: estimate.estimatedSeconds,
      withinCap: estimate.estimatedSeconds <= cap,
    };
  }
}
