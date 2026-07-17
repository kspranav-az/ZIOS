import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  AppUser,
  CandidateIdUpload,
  CreateDispositionBody,
  IdUploadBody,
  IdUploadResponse,
  IntegrityEventBody,
  IntegrityFlagsResponse,
} from '@zios/shared-types';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
import { CurrentUser, Public } from '@/common/decorators';
import { SessionsService } from '@/modules/sessions';
import { IntegrityService } from './integrity.service';

@Controller('sessions/:id/integrity')
export class IntegrityController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly integrity: IntegrityService,
  ) {}

  @Public()
  @Post('events')
  async recordEvents(
    @Param('id') id: string,
    @Body() body: IntegrityEventBody,
  ): Promise<IntegrityFlagsResponse> {
    const session = await this.sessions.getDetail(id);
    const flags = await this.integrity.recordEvents(session.session, null, body);
    return { flags };
  }

  @Get('flags')
  async listFlags(@Param('id') id: string): Promise<IntegrityFlagsResponse> {
    return this.integrity.listFlags(id);
  }

  @Post('flags/:flagId/disposition')
  async dispositionFlag(
    @Param('id') id: string,
    @Param('flagId') flagId: string,
    @CurrentUser() user: AppUser,
    @Body() body: CreateDispositionBody,
  ) {
    return this.integrity.dispositionFlag(id, flagId, user, body);
  }

  @Public()
  @Post('id-upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadIdImage(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @Body() body: IdUploadBody,
  ): Promise<IdUploadResponse> {
    const detail = await this.sessions.getDetail(id);
    return this.integrity.uploadIdImage(
      detail.session,
      body.candidateId,
      file.buffer.toString('base64'),
    );
  }

  @Public()
  @Get('id-upload')
  async listIdUploads(@Param('id') id: string): Promise<{ uploads: CandidateIdUpload[] }> {
    const uploads = await this.integrity.listIdUploads(id);
    return { uploads };
  }

  @Public()
  @Delete('id-upload/:uploadId')
  async eraseIdUpload(@Param('id') id: string, @Param('uploadId') uploadId: string): Promise<void> {
    return this.integrity.eraseIdUpload(id, uploadId);
  }
}
