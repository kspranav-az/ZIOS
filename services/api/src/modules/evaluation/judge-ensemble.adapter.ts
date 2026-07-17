import { Injectable } from '@nestjs/common';
import type { KitQuestion, SessionTranscript } from '@zios/shared-types';
import { LlmGateway } from '@/modules/llm-gateway';
import type { JudgeEvidenceSpan, JudgePort, JudgeResult, JudgeScore } from './judge.port';

interface RawJudgeOutput {
  scores: Array<{
    questionId: string;
    criterionId: string;
    criterionText: string;
    score: number;
    weight: number;
    evidenceSpan: JudgeEvidenceSpan;
  }>;
  metrics: JudgeResult['metrics'];
  recommendation: number;
  confidence: number;
}

const AGREEMENT_THRESHOLD = 1.0;

@Injectable()
export class JudgeEnsembleAdapter implements JudgePort {
  constructor(private readonly gateway: LlmGateway) {}

  async evaluate(
    report: Pick<
      import('@zios/shared-types').EvaluationReport,
      'orgId' | 'sessionId' | 'kitVersionId'
    >,
    transcript: SessionTranscript[],
    questions: KitQuestion[],
  ): Promise<JudgeResult> {
    const variables = { questions, transcript };

    const [a, b] = await Promise.all([
      this.gateway.complete<RawJudgeOutput>({
        task: 'judge_score',
        variables,
        policy: { provider: 'mock', cache: false },
        orgId: report.orgId,
        sessionId: report.sessionId,
      }),
      this.gateway.complete<RawJudgeOutput>({
        task: 'judge_score',
        variables,
        policy: { provider: 'mock', cache: false },
        orgId: report.orgId,
        sessionId: report.sessionId,
      }),
    ]);

    if (this.agree(a.parsed, b.parsed)) {
      return this.normalize(a.parsed);
    }

    const adjudicated = await this.gateway.complete<RawJudgeOutput & { rationale: string }>({
      task: 'judge_adjudicate',
      variables: {
        judgeA: a.parsed,
        judgeB: b.parsed,
      },
      policy: { provider: 'mock', fallback: false, cache: false },
      orgId: report.orgId,
      sessionId: report.sessionId,
    });
    return this.normalize(adjudicated.parsed);
  }

  private agree(a: RawJudgeOutput, b: RawJudgeOutput): boolean {
    if (a.scores.length !== b.scores.length) return false;
    for (let i = 0; i < a.scores.length; i += 1) {
      const scoreA = a.scores[i]?.score ?? 0;
      const scoreB = b.scores[i]?.score ?? 0;
      if (Math.abs(scoreA - scoreB) > AGREEMENT_THRESHOLD) {
        return false;
      }
    }
    return Math.abs(a.recommendation - b.recommendation) <= AGREEMENT_THRESHOLD;
  }

  private normalize(raw: RawJudgeOutput): JudgeResult {
    const scores: JudgeScore[] = raw.scores.map((s) => ({
      questionId: s.questionId,
      criterionId: s.criterionId,
      criterionText: s.criterionText,
      score: Math.max(1, Math.min(5, Math.round(s.score))),
      weight: s.weight,
      evidenceSpan: s.evidenceSpan,
    }));
    return {
      scores,
      metrics: raw.metrics,
      recommendation: Math.max(1, Math.min(5, Math.round(raw.recommendation))),
      confidence: Math.max(0, Math.min(1, raw.confidence)),
    };
  }
}
