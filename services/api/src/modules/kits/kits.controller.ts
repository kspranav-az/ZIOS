import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  AppUser,
  CloneFromBankBody,
  CreateKitBody,
  CreateQuestionBody,
  DurationEstimateResponse,
  KitDetailResponse,
  KitListResponse,
  KitResponse,
  KitVersionListResponse,
  KitVersionResponse,
  PreviewTokenResponse,
  PublishKitResponse,
  QuestionListResponse,
  QuestionResponse,
  RenameTopicBody,
  RenameTopicResponse,
  ReorderQuestionsBody,
  UpdateKitBody,
  UpdateKitSettingsBody,
  UpdateQuestionBody,
} from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import { ApiException } from '@/common/errors';
import { KitsService } from './kits.service';
import { QuestionsService } from './questions.service';

function rejectVersionMutation(): never {
  throw new ApiException(
    409,
    'VERSION_IMMUTABLE',
    'published kit versions are immutable — edit the kit draft and publish a new version (FR-E2-5)',
  );
}

/**
 * Kit Builder routes (PRD E2). All org-scoped through the session tenant
 * context; both roles (admin, interviewer) may author, publish, and archive.
 * Kit/question PATCHes implement the updatedAt optimistic-concurrency guard —
 * see this module's README for the autosave contract.
 */
@Controller('kits')
export class KitsController {
  constructor(
    private readonly kits: KitsService,
    private readonly questions: QuestionsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AppUser, @Body() body: CreateKitBody): Promise<KitResponse> {
    return { kit: await this.kits.create(user, body) };
  }

  @Get()
  async list(
    @CurrentUser() user: AppUser,
    @Query('status') status: string | undefined,
  ): Promise<KitListResponse> {
    return { kits: await this.kits.list(user, status) };
  }

  @Get(':id')
  async getDetail(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<KitDetailResponse> {
    return this.kits.getDetail(user, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: UpdateKitBody,
  ): Promise<KitResponse> {
    return { kit: await this.kits.update(user, id, body) };
  }

  @Patch(':id/settings')
  async updateSettings(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: UpdateKitSettingsBody,
  ): Promise<KitResponse> {
    return { kit: await this.kits.updateSettings(user, id, body) };
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<KitResponse> {
    return { kit: await this.kits.archive(user, id) };
  }

  @Post(':id/unarchive')
  async unarchive(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<KitResponse> {
    return { kit: await this.kits.unarchive(user, id) };
  }

  @Post(':id/publish')
  async publish(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<PublishKitResponse> {
    return { version: await this.kits.publish(user, id) };
  }

  /* ---- immutable versions (FR-E2-5) ---- */

  @Get(':id/versions')
  async listVersions(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<KitVersionListResponse> {
    return { versions: await this.kits.listVersions(user, id) };
  }

  @Get(':id/versions/:version')
  async getVersion(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Param('version') version: string,
  ): Promise<KitVersionResponse> {
    return { version: await this.kits.getVersion(user, id, version) };
  }

  /**
   * Explicit rejection routes: mutating a published version is a domain
   * error (409 VERSION_IMMUTABLE), not a generic 404/405. (Nest method
   * decorators don't stack, so each verb gets its own handler.)
   */
  @Patch(':id/versions/:version')
  rejectVersionPatch(): never {
    return rejectVersionMutation();
  }

  @Put(':id/versions/:version')
  rejectVersionPut(): never {
    return rejectVersionMutation();
  }

  @Delete(':id/versions/:version')
  rejectVersionDelete(): never {
    return rejectVersionMutation();
  }

  @Get(':id/duration-estimate')
  durationEstimate(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<DurationEstimateResponse> {
    return this.kits.durationEstimate(user, id);
  }

  @Post(':id/preview-token')
  createPreviewToken(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<PreviewTokenResponse> {
    return this.kits.createPreviewToken(user, id);
  }

  /* ---- topics & questions ---- */

  @Patch(':id/topics')
  async renameTopic(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: RenameTopicBody,
  ): Promise<RenameTopicResponse> {
    return { updated: await this.questions.renameTopic(user, id, body?.from, body?.to) };
  }

  @Post(':id/questions')
  async addQuestion(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: CreateQuestionBody,
  ): Promise<QuestionResponse> {
    return { question: await this.questions.add(user, id, body) };
  }

  @Get(':id/questions')
  async listQuestions(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<QuestionListResponse> {
    return { questions: await this.questions.list(user, id) };
  }

  @Post(':id/questions/reorder')
  @HttpCode(200)
  async reorder(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: ReorderQuestionsBody,
  ): Promise<QuestionListResponse> {
    return { questions: await this.questions.reorder(user, id, body?.questionIds) };
  }

  @Post(':id/questions/from-bank')
  async cloneFromBank(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: CloneFromBankBody,
  ): Promise<QuestionResponse> {
    return { question: await this.questions.cloneFromBank(user, id, body) };
  }

  @Patch(':id/questions/:questionId')
  async updateQuestion(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() body: UpdateQuestionBody,
  ): Promise<QuestionResponse> {
    return { question: await this.questions.update(user, id, questionId, body) };
  }

  @Delete(':id/questions/:questionId')
  @HttpCode(204)
  async removeQuestion(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ): Promise<void> {
    await this.questions.remove(user, id, questionId);
  }
}
