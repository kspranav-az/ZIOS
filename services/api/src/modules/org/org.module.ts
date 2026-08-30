import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications';
import { UsersModule } from '@/modules/users';
import { InvitesRepository } from './invites.repository';
import { InvitesService } from './invites.service';
import { OrgController } from './org.controller';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [OrgController],
  providers: [OrgRepository, OrgService, InvitesRepository, InvitesService],
  exports: [OrgService, OrgRepository],
})
export class OrgModule {}
