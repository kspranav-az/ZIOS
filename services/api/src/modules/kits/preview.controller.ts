import { Controller, Get, Param } from '@nestjs/common';
import type { AppUser, PreviewResponse } from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import { KitsService } from './kits.service';

/**
 * Preview-as-candidate (FR-E2-6): resolves a 30-minute signed token into a
 * read-only draft projection. Authenticated + org-bound — preview is
 * employer-internal, so rubric lines are included and the session org must
 * match the token's org. Never creates session/persistence rows.
 */
@Controller('preview')
export class PreviewController {
  constructor(private readonly kits: KitsService) {}

  @Get(':token')
  resolve(@CurrentUser() user: AppUser, @Param('token') token: string): Promise<PreviewResponse> {
    return this.kits.resolvePreview(user, token);
  }
}
