import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';

export interface TranscriptionJobData {
  transcriptId: string;
  objectName: string;
  sessionId: string;
  questionId: string;
  inviteId: string;
}

export interface TranscriptionJobResult {
  transcript: string;
}

export function getTranscriptionQueueName(): string {
  return process.env.TRANSCRIPTION_QUEUE_NAME ?? 'async-video-transcription';
}

@Injectable()
export class TranscriptionQueue implements OnModuleDestroy {
  private readonly queue: Queue<TranscriptionJobData, TranscriptionJobResult>;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {
    this.queue = new Queue<TranscriptionJobData, TranscriptionJobResult>(
      getTranscriptionQueueName(),
      { connection: this.redis },
    );
  }

  async add(
    data: TranscriptionJobData,
  ): Promise<Job<TranscriptionJobData, TranscriptionJobResult>> {
    return this.queue.add('transcribe', data, {
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
