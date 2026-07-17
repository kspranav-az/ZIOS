import { Injectable } from '@nestjs/common';
import type { KitQuestion, SessionTranscript } from '@zios/shared-types';
import { computeCommunicationMetrics, rowDurationMinutes } from './metrics';
import { buildScoringUnits } from './segmenter';
import type { JudgeEvidenceSpan, JudgePort, JudgeResult, JudgeScore } from './judge.port';

const FILLER_RE = /\b(um|uh|like)\b/gi;

@Injectable()
export class StubJudgeAdapter implements JudgePort {
  async evaluate(
    _report: { orgId: string; sessionId: string; kitVersionId: string },
    transcript: SessionTranscript[],
    questions: KitQuestion[],
  ): Promise<JudgeResult> {
    const units = buildScoringUnits(transcript, questions);
    const scores: JudgeScore[] = [];

    for (const unit of units) {
      for (const line of unit.question.rubricLines) {
        const evidenceSpan = this.firstEvidenceSpan(unit.rows);
        const score = this.scoreForUnit(unit);
        scores.push({
          questionId: unit.questionId,
          criterionId: line.id,
          criterionText: line.text,
          score,
          weight: line.weight,
          evidenceSpan,
        });
      }
    }

    const metrics = computeCommunicationMetrics(transcript);
    const { recommendation, confidence } = this.aggregate(scores, metrics);

    return { scores, metrics, recommendation, confidence };
  }

  private firstEvidenceSpan(rows: SessionTranscript[]): JudgeEvidenceSpan {
    const row = rows.find((r) => (r.answerText?.length ?? 0) > 0) ?? rows[0];
    const answer = row?.answerText ?? '';
    const end = Math.min(80, answer.length);
    return {
      transcriptId: row?.id ?? '00000000-0000-0000-0000-000000000000',
      questionId: row?.questionId ?? '',
      start: 0,
      end,
      quoteText: answer.slice(0, end),
    };
  }

  private scoreForUnit(unit: { combinedAnswer: string; rows: SessionTranscript[] }): number {
    const len = unit.combinedAnswer.length;
    const fillerHits = (unit.combinedAnswer.match(FILLER_RE) ?? []).length;
    const fillerDensity = len > 0 ? fillerHits / len : 0;
    const spamFiller = fillerDensity > 0.05;

    // Reward longer answers up to a ceiling, unless they are filler spam.
    if (len > 200 && !spamFiller) return 5;
    if (len > 100) return 4;
    if (len > 30) return 3;
    // Very short or near-empty answers map to the lowest band.
    if (len > 0) return 2;
    return 1;
  }

  private aggregate(
    scores: JudgeScore[],
    metrics: { paceWpm: number; fillerCount: number },
  ): { recommendation: number; confidence: number } {
    if (scores.length === 0) {
      return { recommendation: 1, confidence: 0 };
    }

    const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
    const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
    const raw = totalWeight > 0 ? weightedSum / totalWeight : 3;

    // Confidence decays with extreme pace or many fillers.
    let confidence = 0.9;
    if (metrics.paceWpm > 180) confidence -= 0.15;
    if (metrics.paceWpm < 40) confidence -= 0.1;
    if (metrics.fillerCount > 5) confidence -= 0.1;
    confidence = Math.max(0.5, Math.min(0.99, confidence));

    const recommendation = Math.round(raw);
    return { recommendation: Math.max(1, Math.min(5, recommendation)), confidence };
  }
}

export { rowDurationMinutes };
