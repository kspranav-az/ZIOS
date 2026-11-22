import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '@/modules/database';
import type { EmailSender } from '@/modules/notifications';
import { CandidatesRepository } from '@/modules/candidates';
import { KitVersionsRepository } from '@/modules/kits';
import { InviteEmailService } from './invite-email.service';
import { InvitesService } from './invites.service';
import type { InvitesRepository } from './invites.repository';
import type { CsvParserService } from './csv-parser.service';

/**
 * Unit coverage for candidate-invite email delivery
 * (plans/employer-invite-ui-and-email.md, Step 2 / decision D5):
 * emails go out AFTER the transaction commits, are non-fatal, and respect
 * the `notify` flag on create. Reissue always notifies; bulk notifies every
 * successful row even when other rows fail.
 */

const kitTitle = 'Backend Engineer Kit';

const version = {
  id: 'kv-1',
  orgId: 'org-1',
  org_id: 'org-1',
  kitId: 'kit-1',
  snapshot: { kit: { title: kitTitle }, questions: [] },
} as unknown as NonNullable<Awaited<ReturnType<KitVersionsRepository['findById']>>>;

const candidateRow = { id: 'cand-1', orgId: 'org-1', name: 'Ada', email: 'ada@example.com' };
const inviteRow = {
  id: 'inv-1',
  orgId: 'org-1',
  candidateId: 'cand-1',
  expiresAt: new Date(Date.now() + 7 * 86_400_000),
};

function makeService(options: { emailFails?: boolean; parsedRows?: unknown[] } = {}) {
  const q = {};
  const db = {
    withTenant: vi.fn(async (fn: (query: unknown) => Promise<unknown>) => fn(q)),
    transaction: vi.fn(async (fn: (query: unknown) => Promise<unknown>) => fn(q)),
  };
  const candidates = {
    insert: vi.fn(async (input: { name: string; email: string }) => ({
      id: `cand-${input.name}`,
      orgId: 'org-1',
      name: input.name,
      email: input.email,
    })),
    findById: vi.fn(async () => candidateRow),
  };
  const invites = {
    insert: vi.fn(async () => inviteRow),
    update: vi.fn(async () => inviteRow),
    findById: vi.fn(async () => inviteRow),
    findByTokenHash: vi.fn(async () => inviteRow),
  };
  const kitVersions = { findById: vi.fn(async () => version) };
  const csvParser = { parse: vi.fn(async () => options.parsedRows ?? []) };
  const email: EmailSender & { send: ReturnType<typeof vi.fn> } = {
    send: options.emailFails
      ? vi.fn(async () => {
          throw new Error('smtp down');
        })
      : vi.fn(async () => {}),
  };
  const service = new InvitesService(
    db as unknown as DatabaseService,
    candidates as unknown as CandidatesRepository,
    invites as unknown as InvitesRepository,
    kitVersions as unknown as KitVersionsRepository,
    csvParser as unknown as CsvParserService,
    new InviteEmailService(email),
  );
  return { service, email };
}

const createBody = {
  kitVersionId: 'kv-1',
  candidate: { name: 'Ada', email: 'ada@example.com' },
};

describe('InvitesService invite email (candidate invites)', () => {
  it('sends the invite email after commit, with a link containing the raw token', async () => {
    const { service, email } = makeService();
    const res = await service.create('org-1', createBody);
    expect(email.send).toHaveBeenCalledTimes(1);
    const msg = email.send.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(msg.to).toBe('ada@example.com');
    expect(msg.subject).toContain(kitTitle);
    expect(msg.text).toContain(`/?token=${encodeURIComponent(res.token)}`);
  });

  it('does not send when notify is false', async () => {
    const { service, email } = makeService();
    await service.create('org-1', { ...createBody, notify: false });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('still creates the invite when the email adapter throws (D5 non-fatal)', async () => {
    const { service, email } = makeService({ emailFails: true });
    const res = await service.create('org-1', createBody);
    expect(res.invite).toBeDefined();
    expect(res.token).toBeTruthy();
    // sendSafely swallows the rejection — give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('always sends on reissue with the new token', async () => {
    const { service, email } = makeService();
    const res = await service.reissue('org-1', 'inv-1', {});
    expect(email.send).toHaveBeenCalledTimes(1);
    const msg = email.send.mock.calls[0][0] as { text: string };
    expect(msg.text).toContain(`/?token=${encodeURIComponent(res.token)}`);
  });

  it('sends for every successful bulk row and skips failed rows', async () => {
    const rows = [
      { row: 1, errors: [], data: { name: 'Ada', email: 'ada@example.com' } },
      { row: 2, errors: ['missing email'], data: { name: 'Bo', email: '' } },
      { row: 3, errors: [], data: { name: 'Cy', email: 'cy@example.com' } },
    ];
    const { service, email } = makeService({ parsedRows: rows });
    const res = await service.bulkCreateWithKitVersionId('org-1', 'kv-1', Buffer.from('x'));
    expect(res.successes).toBe(2);
    expect(res.errors).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(email.send).toHaveBeenCalledTimes(2);
    const recipients = email.send.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual(['ada@example.com', 'cy@example.com']);
  });

  it('still sends remaining bulk emails when one adapter call fails', async () => {
    let calls = 0;
    const q = {};
    const db = {
      withTenant: vi.fn(async (fn: (query: unknown) => Promise<unknown>) => fn(q)),
      transaction: vi.fn(async (fn: (query: unknown) => Promise<unknown>) => fn(q)),
    };
    const candidates = {
      insert: vi.fn(async (input: { name: string }) => ({ id: `cand-${input.name}`, orgId: 'org-1', ...input })),
    };
    const invites = {
      insert: vi.fn(async (_input: unknown, _q: unknown) => ({
        id: 'inv-1',
        orgId: 'org-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    };
    const kitVersions = { findById: vi.fn(async () => version) };
    const rows = [
      { row: 1, errors: [], data: { name: 'Ada', email: 'ada@example.com' } },
      { row: 2, errors: [], data: { name: 'Bo', email: 'bo@example.com' } },
    ];
    const csvParser = { parse: vi.fn(async () => rows) };
    const email = {
      send: vi.fn(async (msg: { to: string }) => {
        calls += 1;
        if (msg.to === 'ada@example.com') throw new Error('first send fails');
      }),
    };
    const service = new InvitesService(
      db as unknown as DatabaseService,
      candidates as unknown as CandidatesRepository,
      invites as unknown as InvitesRepository,
      kitVersions as unknown as KitVersionsRepository,
      csvParser as unknown as CsvParserService,
      new InviteEmailService(email as unknown as EmailSender),
    );
    const res = await service.bulkCreateWithKitVersionId('org-1', 'kv-1', Buffer.from('x'));
    expect(res.successes).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });
});
