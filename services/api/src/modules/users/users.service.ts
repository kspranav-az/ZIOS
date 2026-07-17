import { Injectable } from '@nestjs/common';
import type { AppUser, AppUserRole } from '@zios/shared-types';
import type { Queryable } from '@/modules/database';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findByEmail(email: string): Promise<AppUser | null> {
    return this.users.findByEmail(email);
  }

  findById(id: string): Promise<AppUser | null> {
    return this.users.findById(id);
  }

  listByOrg(orgId: string, q?: Queryable): Promise<AppUser[]> {
    return this.users.listByOrg(orgId, q);
  }

  emailBelongsToOrg(orgId: string, email: string): Promise<boolean> {
    return this.users.findByOrgAndEmail(orgId, email).then((user) => user !== null);
  }

  /**
   * Mutations take a Queryable so callers compose them inside their own
   * transaction (e.g. org provisioning creates org + user atomically).
   */
  create(
    input: { orgId: string; email: string; name: string; role: AppUserRole },
    q: Queryable,
  ): Promise<AppUser> {
    return this.users.insert(input, q);
  }

  moveToOrg(userId: string, orgId: string, role: AppUserRole, q: Queryable): Promise<AppUser> {
    return this.users.updateOrgAndRole(userId, orgId, role, q);
  }
}
