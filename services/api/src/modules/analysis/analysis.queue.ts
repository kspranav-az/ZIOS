import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';

export type AnalysisJobKind = 'transcription' | 'multimodal_feature_extraction';
export type AnalysisMediaKind = 'video' | 'audio';

export interface AnalysisJobData {
  analysisJobId: string;
  kind: AnalysisJobKind;
  sessionId: string;
  questionId: string | null;
  inviteId: string | null;
  objectName: string;
  mediaKind: AnalysisMediaKind;
  includeTranscript: boolean;
  languageHint?: string | null;
}

export interface AnalysisJobResult {
  status: 'completed';
  schemaVersion: string | null;
}

export function getAnalysisQueueName(): string {
  return process.env.ANALYSIS_QUEUE_NAME ?? 'analysis';
}

@Injectable()
export class AnalysisQueue implements OnModuleDestroy {
  private readonly queue: Queue<AnalysisJobData, AnalysisJobResult>;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {
    this.queue = new Queue<AnalysisJobData, AnalysisJobResult>(getAnalysisQueueName(), {
      connection: this.redis,
    });
  }

  async add(data: AnalysisJobData): Promise<Job<AnalysisJobData, AnalysisJobResult>> {
    return this.queue.add('analyze', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
