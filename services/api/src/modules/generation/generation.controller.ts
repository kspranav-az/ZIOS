import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type {
  AnalyzeJdBody,
  AnalyzeJdResponse,
  AppUser,
  ProposeKitBody,
  ProposeKitResponse,
  PublishProposalBody,
  PublishProposalResponse,
  RegenerateQuestionBody,
} from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import { GenerationService } from './generation.service';

/**
 * JD-based interview generation routes (PRD E3). All routes require an
 * authenticated session; the review/publish handoff is the only path that
 * creates a published kit from a generation proposal.
 */
@Controller('generation')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  @Get(':id')
  async get(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<ProposeKitResponse> {
    const generation = await this.generation.getGeneration(user.orgId, id);
    return {
      generation,
      profile: generation.roleProfile,
      proposal: generation.proposal,
    };
  }

  @Post('analyze')
  async analyze(
    @CurrentUser() user: AppUser,
    @Body() body: AnalyzeJdBody,
  ): Promise<AnalyzeJdResponse> {
    const profile = await this.generation.analyze(user.orgId, body?.jdText);
    return { profile };
  }

  @Post('propose')
  @HttpCode(201)
  async propose(
    @CurrentUser() user: AppUser,
    @Body() body: ProposeKitBody,
  ): Promise<ProposeKitResponse> {
    const generation = await this.generation.analyzeAndPropose(user.orgId, body?.jdText);
    return {
      generation,
      profile: generation.roleProfile,
      proposal: generation.proposal,
    };
  }

  @Post(':id/publish')
  @HttpCode(201)
  async publish(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: PublishProposalBody,
  ): Promise<PublishProposalResponse> {
    const result = await this.generation.publishProposal(user, id, body?.proposal, body?.edits);
    return result;
  }

  @Post(':id/regenerate')
  async regenerate(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: RegenerateQuestionBody,
  ): Promise<ProposeKitResponse> {
    const generation = await this.generation.regenerateQuestion(
      user.orgId,
      id,
      body?.index ?? 0,
      body?.constraints,
    );
    return {
      generation,
      profile: generation.roleProfile,
      proposal: generation.proposal,
    };
  }
}
