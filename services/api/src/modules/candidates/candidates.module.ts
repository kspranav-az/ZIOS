import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { CandidatesRepository } from './candidates.repository';

@Module({
  imports: [DatabaseModule],
  providers: [CandidatesRepository],
  exports: [CandidatesRepository],
})
export class CandidatesModule {}
