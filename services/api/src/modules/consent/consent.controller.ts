import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AppUser, ConsentResponse, CreateConsentBody } from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import { DatabaseService } from '@/modules/database';
import { ConsentService } from './consent.service';

@Controller('consents')
export class ConsentController {
  constructor(
    private readonly service: ConsentService,
    private readonly db: DatabaseService,
  ) {}

  @Post()
  async create(
    @CurrentUser() _user: AppUser,
    @Body() body: CreateConsentBody,
  ): Promise<ConsentResponse> {
    const consent = await this.db.transaction((q) => this.service.create(body, q));
    return { consent };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ConsentResponse> {
    return { consent: await this.service.get(id) };
  }
}
