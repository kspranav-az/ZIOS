import { Module } from '@nestjs/common';
import { OrgModule } from '@/modules/org';
import { CreditsService } from './credits.service';

@Module({
  imports: [OrgModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
