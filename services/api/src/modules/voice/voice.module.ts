import { Module } from '@nestjs/common';
import { AnalysisModule } from '@/modules/analysis';
import { ConsentModule } from '@/modules/consent';
import { CreditsModule } from '@/modules/credits';
import { DatabaseModule } from '@/modules/database';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { SessionsModule } from '@/modules/sessions';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [
    DatabaseModule,
    SessionsModule,
    LlmGatewayModule,
    AnalysisModule,
    ConsentModule,
    CreditsModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
