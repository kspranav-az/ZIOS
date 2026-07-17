import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { SessionsModule } from '@/modules/sessions';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [DatabaseModule, SessionsModule, LlmGatewayModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
