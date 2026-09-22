import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import { DatabaseService } from '@/modules/database';
import { EvaluationService } from './evaluation.service';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { EvidenceSpanRepository } from './evidence-span.repository';
import { PipelineLogRepository } from './pipeline-log.repository';
import { OverrideRepository } from './override.repository';
import { InterviewNotesRepository } from './notes.repository';
import { LlmGateway } from '@/modules/llm-gateway';
import { JudgePort } from './judge.port';
import type { AppUser } from '@zios/shared-types';

const sessionId = randomUUID();
const reportId = randomUUID();
const kitVersionId = randomUUID();
const inviteId = randomUUID();

function fakeUser(): AppUser {
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    email: 'interviewer@local.test',
    name: 'Interviewer',
    role: 'admin',
    createdAt: new Date().toISOString(),
  };
}

function fakeDb(): DatabaseService {
  return {
    transaction: async (fn: (client: PoolClient) => Promise<unknown>) =>
      fn({
        query: vi.fn(async (text: string) =>
          text.includes('RETURNING')
            ? { rows: [{ id: randomUUID(), occurred_at: new Date() }] }
            : { rows: [] },
        ),
      } as unknown as PoolClient),
    query: vi.fn(),
  } as unknown as DatabaseService;
}

function mockDbForSubmit(db: DatabaseService, user: AppUser) {
  const q = db.query as ReturnType<typeof vi.fn>;
  q.mockImplementation(async (text: string) => {
    if (text.includes('FROM interview_session')) {
      return {
        rows: [
          {
            id: sessionId,
            invite_id: inviteId,
            conductor: 'human',
            org_id: user.orgId,
            kit_version_id: kitVersionId,
          },
        ],
      };
    }
    if (text.includes('FROM session_transcript')) {
      return { rows: [] };
    }
    if (text.includes('FROM evaluation_report WHERE session_id')) {
      return {
        rows: [
          {
            id: reportId,
            org_id: user.orgId,
            session_id: sessionId,
            invite_id: inviteId,
            kit_version_id: kitVersionId,
            status: 'pending',
            overall_recommendation: null,
            overall_confidence: null,
            communication_metrics: {},
            rubric_version: 'phase04-stub',
            model_route: 'human-facilitated',
            cost: 0,
            prompt_versions: {},
            error_message: null,
            scorecard_meta: {},
            notes_id: null,
            started_at: null,
            completed_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    }
    return { rows: [] };
  });
}

function buildService(db: DatabaseService, user: AppUser) {
  const reports = {
    findBySessionId: vi.fn().mockResolvedValue({
      id: reportId,
      orgId: user.orgId,
      sessionId,
      inviteId,
      kitVersionId,
      status: 'pending',
      overallRecommendation: null,
      overallConfidence: null,
      communicationMetrics: {},
      rubricVersion: 'phase04-stub',
      modelRoute: 'human-facilitated',
      cost: 0,
      promptVersions: {},
      errorMessage: null,
      scorecard: null,
      notes: null,
      notesId: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    insert: vi.fn().mockResolvedValue({ id: reportId }),
    updateScorecard: vi.fn().mockResolvedValue({ id: reportId }),
  } as unknown as EvaluationRepository;

  const scores = {
    deleteByReportId: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: randomUUID() }),
    listByReportId: vi.fn().mockResolvedValue([]),
  } as unknown as EvaluationScoreRepository;

  const evidenceSpans = {
    deleteByReportId: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue({ id: randomUUID() }),
    listByReportId: vi.fn().mockResolvedValue([]),
  } as unknown as EvidenceSpanRepository;

  const pipelineLogs = {} as PipelineLogRepository;
  const overrides = {
    listByReportId: vi.fn().mockResolvedValue([]),
  } as unknown as OverrideRepository;
  const notesRepo = {
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as InterviewNotesRepository;
  const judge = {} as JudgePort;
  const llmGateway = { getJournal: vi.fn().mockReturnValue([]) } as unknown as LlmGateway;
  const webhookFanout = {
    fanout: vi.fn().mockResolvedValue([]),
  } as unknown as import('@/modules/webhooks').WebhookFanoutService;
  const webhookQueue = {
    add: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('@/modules/webhooks').WebhooksQueue;

  const service = new EvaluationService(
    db,
    reports,
    scores,
    evidenceSpans,
    pipelineLogs,
    overrides,
    notesRepo,
    judge,
    llmGateway,
    webhookFanout,
    webhookQueue,
  );

  return { service, reports };
}

describe('EvaluationService.submitHumanScorecard', () => {
  const user = fakeUser();

  it('submits a valid scorecard and rounds the overall recommendation to an integer', async () => {
    const db = fakeDb();
    mockDbForSubmit(db, user);
    const { service, reports } = buildService(db, user);

    const body = {
      scores: [
        { questionId: 'q1', criterionId: 'c1', criterionText: 'A', score: 2, weight: 1 },
        { questionId: 'q1', criterionId: 'c2', criterionText: 'B', score: 3, weight: 2 },
      ],
      prefillAccepted: false,
      editCount: 1,
    };

    await service.submitHumanScorecard(user.orgId, sessionId, user, body);

    expect(reports.updateScorecard).toHaveBeenCalled();
    const passed = (reports.updateScorecard as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      overallRecommendation: number;
    };
    expect(passed.overallRecommendation).toBe(3); // (2*1 + 3*2) / 3 = 2.67 -> 3
  });

  it('rejects non-integer scores', async () => {
    const db = fakeDb();
    mockDbForSubmit(db, user);
    const { service } = buildService(db, user);

    const body = {
      scores: [{ questionId: 'q1', criterionId: 'c1', criterionText: 'A', score: 2.5, weight: 1 }],
      prefillAccepted: false,
      editCount: 0,
    };

    await expect(service.submitHumanScorecard(user.orgId, sessionId, user, body)).rejects.toThrow(
      ApiException,
    );
  });

  it('rejects scores outside 1..5', async () => {
    const db = fakeDb();
    mockDbForSubmit(db, user);
    const { service } = buildService(db, user);

    await expect(
      service.submitHumanScorecard(user.orgId, sessionId, user, {
        scores: [{ questionId: 'q1', criterionId: 'c1', criterionText: 'A', score: 0, weight: 1 }],
        prefillAccepted: false,
        editCount: 0,
      }),
    ).rejects.toThrow(ApiException);

    await expect(
      service.submitHumanScorecard(user.orgId, sessionId, user, {
        scores: [{ questionId: 'q1', criterionId: 'c1', criterionText: 'A', score: 6, weight: 1 }],
        prefillAccepted: false,
        editCount: 0,
      }),
    ).rejects.toThrow(ApiException);
  });

  it('rejects non-positive weights', async () => {
    const db = fakeDb();
    mockDbForSubmit(db, user);
    const { service } = buildService(db, user);

    const body = {
      scores: [{ questionId: 'q1', criterionId: 'c1', criterionText: 'A', score: 3, weight: 0 }],
      prefillAccepted: false,
      editCount: 0,
    };

    await expect(service.submitHumanScorecard(user.orgId, sessionId, user, body)).rejects.toThrow(
      ApiException,
    );
  });
});
