import { Module } from '@nestjs/common';
import { SessionsModule } from '@/modules/sessions';
import { StorageClient } from '@/modules/storage';
import { IntegrityController } from './integrity.controller';
import { IntegrityRepository } from './integrity.repository';
import { IntegrityService } from './integrity.service';

@Module({
  imports: [SessionsModule],
  controllers: [IntegrityController],
  providers: [IntegrityService, IntegrityRepository, StorageClient],
  exports: [IntegrityService],
})
export class IntegrityModule {}
