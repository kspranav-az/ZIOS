export { EvaluationModule } from './evaluation.module';
export { EvaluationService } from './evaluation.service';
export { JUDGE_PORT, type JudgePort, type JudgeResult } from './judge.port';
export { StubJudgeAdapter } from './stub-judge.adapter';
export { computeCommunicationMetrics } from './metrics';
export { buildScoringUnits, type ScoringUnit } from './segmenter';
