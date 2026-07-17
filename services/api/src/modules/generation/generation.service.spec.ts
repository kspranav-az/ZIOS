import { describe, expect, it, vi } from 'vitest';
import type {
  AppUser,
  JdGeneration,
  JdProfile,
  ProposedQuestion,
  QuestionBankItem,
  QuestionType,
} from '@zios/shared-types';
import type { KitsService } from '@/modules/kits';
import type { ExternalQuestionSourcePort } from './external-question-source.port';
import { GenerationRepository } from './generation.repository';
import { GenerationService } from './generation.service';
import type { LlmGatewayPort } from './llm-gateway.port';

const user: AppUser = {
  id: 'user-1',
  orgId: 'org-1',
  email: 'admin@acme.com',
  name: 'Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
};

function makeProfile(overrides: Partial<JdProfile> = {}): JdProfile {
  return {
    title: 'Senior Backend Engineer',
    seniority: 'senior',
    roleFamily: 'engineer',
    skills: ['Python', 'PostgreSQL', 'Redis', 'System design'],
    niceToHaveSkills: ['Kubernetes'],
    responsibilities: ['Design APIs', 'Mentor engineers', 'Review code'],
    tools: ['PostgreSQL', 'Redis'],
    languages: [],
    raw: {},
    ...overrides,
  };
}

function makeQuestion(topic: string, type: QuestionType): ProposedQuestion {
  return {
    topic,
    type,
    prompt: `Question about ${topic}`,
    options:
      type === 'mcq_single' || type === 'mcq_multi'
        ? [
            { id: 'a', text: 'Good', correct: true },
            { id: 'b', text: 'Bad', correct: false },
          ]
        : null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: type === 'open_ended' ? 'adaptive_ai' : 'none',
    followupFixed: null,
    followupDepthCap: type === 'open_ended' ? 2 : null,
    rubricLines: [
      { id: 'r1', text: 'Clarity', weight: 0.5 },
      { id: 'r2', text: 'Depth', weight: 0.5 },
    ],
    source: 'jd_generated',
    sourceRef: null,
  };
}

function makeService({ profile = makeProfile(), bankItems = [] as QuestionBankItem[] } = {}) {
  const llm: LlmGatewayPort = {
    analyzeJd: vi.fn(async () => profile),
    draftQuestions: vi.fn(async (_profile, topic, type, count) =>
      Array.from({ length: count }, () => makeQuestion(topic, type)),
    ),
  };
  const external: ExternalQuestionSourcePort = {
    search: vi.fn(async () => bankItems),
  };
  const state: JdGeneration = {
    id: 'gen-1',
    orgId: 'org-1',
    kitId: null,
    jdHash: 'hash',
    promptVersion: 'phase05-stub',
    status: 'analyzing',
    roleProfile: makeProfile(),
    proposal: { topics: [], questions: [], durationEstimateSec: 0, withinCap: true },
    edits: [],
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const repository: GenerationRepository = {
    insert: vi.fn(async (input) => {
      Object.assign(state, input);
      return { ...state };
    }) as unknown as GenerationRepository['insert'],
    findById: vi.fn(async () => ({ ...state })) as unknown as GenerationRepository['findById'],
    update: vi.fn(async (_orgId, _id, input) => {
      Object.assign(state, input);
      return { ...state };
    }) as unknown as GenerationRepository['update'],
  } as unknown as GenerationRepository;
  const kits = {
    createFromProposal: vi.fn(async () => ({
      kit: { id: 'kit-1' },
      version: {
        id: 'v1',
        kitId: 'kit-1',
        version: 1,
        publishedBy: user.id,
        publishedAt: new Date().toISOString(),
      },
    })),
  } as unknown as KitsService;

  const service = new GenerationService(llm, external, repository, kits);
  return { service, llm, external, repository, kits };
}

describe('GenerationService planner invariants', () => {
  it('proposes 4–8 topics and 8–15 questions within the duration cap', async () => {
    const { service } = makeService();
    const generation = await service.analyzeAndPropose('org-1', SAMPLE_JD);
    expect(generation.status).toBe('proposed');
    expect(generation.proposal.topics.length).toBeGreaterThanOrEqual(4);
    expect(generation.proposal.topics.length).toBeLessThanOrEqual(8);
    expect(generation.proposal.questions.length).toBeGreaterThanOrEqual(8);
    expect(generation.proposal.questions.length).toBeLessThanOrEqual(15);
    expect(generation.proposal.withinCap).toBe(true);
    expect(generation.proposal.durationEstimateSec).toBeLessThanOrEqual(1800);
  });

  it('normalizes rubric weights so every proposed question can be published', async () => {
    const { service } = makeService();
    const generation = await service.analyzeAndPropose('org-1', SAMPLE_JD);
    for (const question of generation.proposal.questions) {
      const sum = question.rubricLines.reduce((acc, line) => acc + line.weight, 0);
      expect(sum).toBeCloseTo(1, 2);
    }
  });

  it('uses external bank questions when available and fills remaining gaps', async () => {
    const bankItem: QuestionBankItem = {
      id: 'bank-1',
      roleFamily: 'backend',
      topic: 'Python',
      type: 'open_ended',
      difficulty: 'medium',
      prompt: 'Bank question about Python.',
      options: null,
      rubricLines: [{ id: 'rb1', text: 'Quality', weight: 1 }],
      tags: [],
      createdAt: new Date().toISOString(),
    };
    const { service, external } = makeService({ bankItems: [bankItem] });
    const generation = await service.analyzeAndPropose('org-1', SAMPLE_JD);
    expect(external.search).toHaveBeenCalled();
    expect(generation.proposal.questions.length).toBeGreaterThanOrEqual(8);
  });
});

describe('GenerationService regenerate', () => {
  it('preserves topic and type constraints when regenerating a single question', async () => {
    const { service } = makeService();
    const before = await service.analyzeAndPropose('org-1', SAMPLE_JD);
    const targetIndex = 2;
    const original = before.proposal.questions[targetIndex]!;
    const after = await service.regenerateQuestion('org-1', before.id, targetIndex);
    const regenerated = after.proposal.questions[targetIndex]!;
    expect(regenerated.topic).toBe(original.topic);
    expect(regenerated.type).toBe(original.type);
    expect(after.proposal.questions.length).toBe(before.proposal.questions.length);
  });
});

const SAMPLE_JD = `
Title: Senior Backend Engineer

Responsibilities:
- Design and ship scalable APIs
- Mentor junior engineers
- Review system designs

Requirements / Skills:
- Python, PostgreSQL, Redis, System design
- Strong communication
- 5+ years of backend experience
`;
