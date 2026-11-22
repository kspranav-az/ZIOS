import { beforeEach, describe, expect, it, vi } from 'vitest';
import { candidateLink, invitesApi } from '../lib/invites-api';

/**
 * invites-api client contract (plans/employer-invite-ui-and-email.md, Step 6):
 * bulk upload goes out as multipart FormData (never JSON — the browser must
 * set the boundary), the kit binding rides in the query string, and the
 * copyable link URL-encodes the raw token.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

describe('invitesApi.bulk', () => {
  it('sends multipart FormData with the kitVersionId in the query string', async () => {
    const file = new File(['name,email\nAda,ada@example.com\n'], 'invites.csv', {
      type: 'text/csv',
    });
    await invitesApi.bulk('kv-123', file);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/invites/bulk?kitVersionId=kv-123');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    // The client must NOT set a JSON content type — the browser adds the
    // multipart boundary itself; a wrong content type yields a confusing
    // "CSV file is required" 400 from the controller.
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBeNull();
    expect(init.credentials).toBe('include');
  });

  it('URL-encodes the kitVersionId', async () => {
    const file = new File(['x'], 'x.csv');
    await invitesApi.bulk('kv with spaces/and&chars', file);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain(`kitVersionId=${encodeURIComponent('kv with spaces/and&chars')}`);
  });
});

describe('invitesApi.create / reissue / reschedule', () => {
  it('POSTs JSON bodies to the expected routes', async () => {
    await invitesApi.create({
      kitVersionId: 'kv-1',
      candidate: { name: 'Ada', email: 'ada@example.com' },
    });
    await invitesApi.reissue('inv-1');
    await invitesApi.reschedule('inv-1', { extendDays: 7 });

    const urls = fetchMock.mock.calls.map((c) => (c[0] as string) + '|' + ((c[1] as RequestInit)?.method ?? 'GET'));
    expect(urls).toEqual([
      expect.stringContaining('/invites|POST'),
      expect.stringContaining('/invites/inv-1/reissue|POST'),
      expect.stringContaining('/invites/inv-1/reschedule|POST'),
    ]);
    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});

describe('candidateLink', () => {
  it('URL-encodes the token into the candidate base URL', () => {
    const link = candidateLink('raw token/with+chars=');
    expect(link).toContain('/?token=');
    expect(link).toContain(encodeURIComponent('raw token/with+chars='));
    expect(link).not.toContain('raw token/');
  });
});
