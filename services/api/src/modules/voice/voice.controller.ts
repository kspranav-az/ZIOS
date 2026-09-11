import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import type {
  InterviewSession,
  VoiceFallbackBody,
  VoiceFallbackResponse,
  VoiceTokenResponse,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { Public } from '@/common/decorators';
import { VoiceService, type VoiceTelemetryPayload } from './voice.service';

function recoveryToken(header: string | undefined): string {
  if (!header) {
    throw new ApiException(401, 'RECOVERY_TOKEN_MISSING', 'X-Recovery-Token header is required');
  }
  return header.trim();
}

@Controller('sessions/:id/voice')
export class VoiceController {
  constructor(private readonly service: VoiceService) {}

  @Public()
  @Post('token')
  @HttpCode(200)
  async issueToken(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
  ): Promise<VoiceTokenResponse> {
    return this.service.issueToken(id, recoveryToken(recovery));
  }

  @Public()
  @Post('fallback')
  @HttpCode(200)
  async fallback(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
    @Body() body: VoiceFallbackBody,
  ): Promise<VoiceFallbackResponse> {
    return this.service.fallbackToText(id, recoveryToken(recovery), body);
  }

  @Public()
  @Post('telemetry')
  @HttpCode(200)
  async telemetry(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
    @Body() body: VoiceTelemetryPayload,
  ): Promise<InterviewSession> {
    return this.service.recordTelemetry(id, recoveryToken(recovery), body);
  }
}
