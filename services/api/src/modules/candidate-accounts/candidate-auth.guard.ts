import {
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { CandidateAccount, CandidateSessionInfo } from '@zios/shared-types';
import type { Request } from 'express';
import { SessionService } from '@/modules/auth';
import { ApiException } from '@/common/errors';
import { CandidateAccountRepository } from './candidate-account.repository';
import { CandidateSessionService } from './candidate-session.service';

export interface CandidateAuthContext {
  session: { id: string; token: string };
  account: CandidateAccount;
}

const CANDIDATE_AUTH_KEY = Symbol('zios.candidateAuth');

type CandidateRequest = Request & { [CANDIDATE_AUTH_KEY]?: CandidateAuthContext };

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Candidate-audience auth (Phase 12, D8): resolves ONLY candidate_session
 * tokens. Controllers are @Public() (like /v1) so the global session guards
 * skip them; this guard enforces candidate auth locally. An employer session
 * token is detected and rejected with 403 — the audiences never
 * cross-validate.
 */
@Injectable()
export class CandidateAuthGuard implements CanActivate {
  constructor(
    private readonly candidateSessions: CandidateSessionService,
    private readonly employerSessions: SessionService,
    private readonly accounts: CandidateAccountRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CandidateRequest>();
    const token = extractBearer(req);
    if (!token) {
      throw new ApiException(401, 'UNAUTHENTICATED', 'a candidate session is required');
    }
    const resolved = await this.candidateSessions.resolve(token);
    if (resolved) {
      const account = await this.accounts.findById(resolved.accountId);
      if (!account) {
        throw new ApiException(401, 'INVALID_TOKEN', 'candidate account no longer exists');
      }
      const sessionInfo: CandidateSessionInfo = {
        token,
        expiresAt: resolved.sessionExpiresAt.toISOString(),
      };
      req[CANDIDATE_AUTH_KEY] = {
        session: { id: resolved.sessionId, token: sessionInfo.token },
        account,
      };
      return true;
    }
    // Employer token presented on a candidate route → audience violation.
    if (await this.employerSessions.isActiveToken(token)) {
      throw new ApiException(403, 'INVALID_TOKEN_AUDIENCE', 'employer tokens are not valid here');
    }
    throw new ApiException(401, 'INVALID_TOKEN', 'invalid or expired candidate session');
  }
}

/** Injects the candidate auth context resolved by CandidateAuthGuard. */
export const CurrentCandidate = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CandidateAuthContext => {
    const req = ctx.switchToHttp().getRequest<CandidateRequest>();
    const auth = req[CANDIDATE_AUTH_KEY];
    if (!auth) {
      throw new Error('@CurrentCandidate() used on a route without CandidateAuthGuard');
    }
    return auth;
  },
);
