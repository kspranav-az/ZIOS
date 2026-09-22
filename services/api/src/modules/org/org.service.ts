import { Injectable } from '@nestjs/common';
import type { AppUser, Org } from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';
import { UsersService } from '@/modules/users';
import { orgNameFromEmail, userNameFromEmail } from './naming';
import { OrgRepository } from './org.repository';

@Injectable()
export class OrgService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgs: OrgRepository,
    private readonly users: UsersService,
  ) {}

  /**
   * First-login provisioning (FR-E1-1): a brand-new email gets a new org on
   * the 'pilot' plan and becomes its first 'admin' user — atomically.
   *
   * New orgs also receive a welcome credit grant (FR-E14) so they can run
   * interviews immediately; the ledger row keeps the grant auditable.
   */
  async provisionSignup(email: string): Promise<{ org: Org; user: AppUser }> {
    return this.db.transaction(async (client) => {
      const org = await this.orgs.insert({ name: orgNameFromEmail(email), plan: 'pilot' }, client);
      const welcomeCredits = 100;
      await client.query(
        `UPDATE "org" SET credits_balance = credits_balance + $2 WHERE id = $1`,
        [org.id, welcomeCredits],
      );
      await client.query(
        `INSERT INTO credit_ledger (org_id, delta, balance_after, reason, metadata)
         VALUES ($1, $2, $2, 'welcome_grant', $3::jsonb)`,
        [org.id, welcomeCredits, JSON.stringify({ plan: 'pilot' })],
      );
      const user = await this.users.create(
        { orgId: org.id, email, name: userNameFromEmail(email), role: 'admin' },
        client,
      );
      return { org, user };
    });
  }

  findById(id: string): Promise<Org | null> {
    return this.orgs.findById(id);
  }

  /** Tenant-scoped read: runs inside the request's TenantContext (RLS-ready). */
  listMembers(orgId: string): Promise<AppUser[]> {
    return this.db.withTenant((client) => this.users.listByOrg(orgId, client));
  }
}
