import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { ConsentController } from './consent.controller';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ConsentController],
  providers: [ConsentRepository, ConsentService],
  exports: [ConsentService, ConsentRepository],
})
export class ConsentModule {}
