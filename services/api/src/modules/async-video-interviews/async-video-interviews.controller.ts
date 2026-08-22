import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AppUser } from '@zios/shared-types';
import { CurrentUser, Public } from '@/common/decorators';
import { ApiException } from '@/common/errors';
import {
  AsyncVideoInterviewsService,
  type AsyncConsentInput,
  type AsyncScoreInput,
  type CreateAsyncVideoInterviewInput,
} from './async-video-interviews.service';

interface UploadedVideoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

function recoveryToken(header: string | undefined): string {
  if (!header) {
    throw new ApiException(401, 'RECOVERY_TOKEN_MISSING', 'X-Recovery-Token header is required');
  }
  return header.trim();
}

@Controller('async-video-interviews')
export class AsyncVideoInterviewsController {
  constructor(private readonly service: AsyncVideoInterviewsService) {}

  /* ---- employer-facing (auth required) ---- */

  @Post()
  async create(
    @CurrentUser() user: AppUser,
    @Body() body: CreateAsyncVideoInterviewInput,
  ): Promise<ReturnType<AsyncVideoInterviewsService['create']>> {
    return this.service.create({ ...body, orgId: user.orgId });
  }

  @Get(':sessionId/review')
  async getReview(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
  ): Promise<ReturnType<AsyncVideoInterviewsService['getReview']>> {
    return this.service.getReview(user.orgId, sessionId);
  }

  @Post(':sessionId/questions/:questionId/score')
  @HttpCode(200)
  async submitScore(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Body() body: AsyncScoreInput,
  ): Promise<ReturnType<AsyncVideoInterviewsService['submitScore']>> {
    return this.service.submitScore(user.orgId, sessionId, questionId, user, body);
  }

  /* ---- public candidate-facing ---- */

  @Public()
  @Post('by-token/:token/consent')
  @HttpCode(200)
  async consentByToken(
    @Param('token') token: string,
    @Body() body: AsyncConsentInput,
  ): Promise<ReturnType<AsyncVideoInterviewsService['consentByToken']>> {
    return this.service.consentByToken(token, body);
  }

  @Public()
  @Get(':sessionId/questions')
  async getQuestions(
    @Param('sessionId') sessionId: string,
    @Headers('x-recovery-token') recovery: string | undefined,
  ): Promise<ReturnType<AsyncVideoInterviewsService['getQuestions']>> {
    return this.service.getQuestions(sessionId, recoveryToken(recovery));
  }

  @Public()
  @Post(':sessionId/questions/:questionId/video')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('video'))
  async uploadVideo(
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Headers('x-recovery-token') recovery: string | undefined,
    @Body() body: { durationSec?: string },
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: 250 * 1024 * 1024,
            message: 'video must be under 250 MB',
          }),
        ],
        fileIsRequired: true,
      }),
    )
    file: UploadedVideoFile,
  ): Promise<ReturnType<AsyncVideoInterviewsService['uploadVideoAnswer']>> {
    const durationSec = body?.durationSec ? Number(body.durationSec) : undefined;
    return this.service.uploadVideoAnswer(
      sessionId,
      questionId,
      recoveryToken(recovery),
      file.buffer,
      Number.isFinite(durationSec) ? { durationSec } : undefined,
    );
  }
}
