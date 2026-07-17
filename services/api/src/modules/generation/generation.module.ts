import { Module } from '@nestjs/common';
import { QuestionBankModule } from '@/modules/question-bank';
import { KitsModule } from '@/modules/kits';
import { EXTERNAL_QUESTION_SOURCE_PORT } from './external-question-source.port';
import { GenerationController } from './generation.controller';
import { GenerationRepository } from './generation.repository';
import { GenerationService } from './generation.service';
import { LLM_GATEWAY_PORT } from './llm-gateway.port';
import { StubExternalQuestionSourceAdapter } from './stub-external-question-source.adapter';
import { StubLlmAdapter } from './stub-llm.adapter';

@Module({
  imports: [KitsModule, QuestionBankModule],
  controllers: [GenerationController],
  providers: [
    GenerationRepository,
    GenerationService,
    { provide: LLM_GATEWAY_PORT, useClass: StubLlmAdapter },
    {
      provide: EXTERNAL_QUESTION_SOURCE_PORT,
      useClass: StubExternalQuestionSourceAdapter,
    },
  ],
})
export class GenerationModule {}
