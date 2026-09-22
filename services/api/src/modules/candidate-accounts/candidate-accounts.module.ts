import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth';
import { CreditsModule } from '@/modules/credits';
import { CandidateAccountRepository } from './candidate-account.repository';
import { CandidateAccountsController } from './candidate-accounts.controller';
import { CandidateAccountsService } from './candidate-accounts.service';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { CandidateSessionRepository } from './candidate-session.repository';
import { CandidateSessionService } from './candidate-session.service';

@Module({
  imports: [AuthModule, CreditsModule],
  controllers: [CandidateAccountsController],
  providers: [
    CandidateAccountRepository,
    CandidateAccountsService,
    CandidateSessionRepository,
    CandidateSessionService,
    CandidateAuthGuard,
  ],
  exports: [
    CandidateAccountRepository,
    CandidateAccountsService,
    CandidateSessionRepository,
    CandidateSessionService,
    CandidateAuthGuard,
  ],
})
export class CandidateAccountsModule {}
