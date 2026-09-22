import { Module } from '@nestjs/common';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { QuestionBankModule } from '@/modules/question-bank';
import { KitsModule } from '@/modules/kits';
import { EXTERNAL_QUESTION_SOURCE_PORT } from './external-question-source.port';
import { GenerationController } from './generation.controller';
import { GenerationRepository } from './generation.repository';
import { GenerationService } from './generation.service';
import { LLM_GATEWAY_PORT } from './llm-gateway.port';
import { LlmGenerationAdapter } from './llm-generation.adapter';
import { StubExternalQuestionSourceAdapter } from './stub-external-question-source.adapter';

@Module({
  imports: [KitsModule, QuestionBankModule, LlmGatewayModule],
  controllers: [GenerationController],
  providers: [
    GenerationRepository,
    GenerationService,
    { provide: LLM_GATEWAY_PORT, useClass: LlmGenerationAdapter },
    {
      provide: EXTERNAL_QUESTION_SOURCE_PORT,
      useClass: StubExternalQuestionSourceAdapter,
    },
  ],
  exports: [GenerationService],
})
export class GenerationModule {}
