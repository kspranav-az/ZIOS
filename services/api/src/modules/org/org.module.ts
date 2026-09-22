import { Module } from '@nestjs/common';
import { CreditsModule } from '@/modules/credits';
import { NotificationsModule } from '@/modules/notifications';
import { UsersModule } from '@/modules/users';
import { InvitesRepository } from './invites.repository';
import { InvitesService } from './invites.service';
import { OrgController } from './org.controller';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';

@Module({
  imports: [UsersModule, NotificationsModule, CreditsModule],
  controllers: [OrgController],
  providers: [OrgRepository, OrgService, InvitesRepository, InvitesService],
  exports: [OrgService, OrgRepository],
})
export class OrgModule {}
