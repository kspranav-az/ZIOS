import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeysPage } from '../pages/shell/ApiKeysPage';
import { listApiKeys, createApiKey, rotateApiKey, revokeApiKey } from '../lib/keys-api';
import type { ApiKeyView, CreatedApiKeyView } from '../lib/keys-api';

vi.mock('../lib/keys-api', () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}));

import { useAuth } from '../auth/AuthContext';

const mockedList = vi.mocked(listApiKeys);
const mockedCreate = vi.mocked(createApiKey);
const mockedRotate = vi.mocked(rotateApiKey);
const mockedRevoke = vi.mocked(revokeApiKey);
const mockedUseAuth = vi.mocked(useAuth);

function keyView(overrides: Partial<ApiKeyView> = {}): ApiKeyView {
  return {
    id: 'key-1',
    kind: 'test',
    prefix: 'zios_test_a1',
    label: 'ATS sandbox',
    scopes: ['interviews:read', 'interviews:write'],
    rateLimitPerMin: 120,
    createdAt: '2026-09-22T10:00:00Z',
    rotatedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function authAs(role: 'admin' | 'interviewer') {
  mockedUseAuth.mockReturnValue({
    state: { status: 'authenticated', user: { role }, org: { id: 'org-1' } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApiKeysPage', () => {
  it('lists keys with admin actions for admins', async () => {
    authAs('admin');
    mockedList.mockResolvedValue({ keys: [keyView()] });
    render(<ApiKeysPage />);

    await waitFor(() => expect(screen.getByText('zios_test_a1…')).toBeInTheDocument());
    expect(screen.getByText('ATS sandbox')).toBeInTheDocument();
    expect(screen.getByText('TEST')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('hides mutations for interviewers and shows the empty-state hint', async () => {
    authAs('interviewer');
    mockedList.mockResolvedValue({ keys: [] });
    render(<ApiKeysPage />);

    await waitFor(() => expect(screen.getByText('No API keys')).toBeInTheDocument());
    expect(screen.getByText('Ask an admin to create an API key.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument();
  });

  it('reveals the full key exactly once after creation', async () => {
    authAs('admin');
    mockedList.mockResolvedValue({ keys: [] });
    const created: CreatedApiKeyView = { ...keyView(), key: 'zios_test_FULLKEYMATERIAL' };
    mockedCreate.mockResolvedValue(created);
    const user = userEvent.setup();
    render(<ApiKeysPage />);

    await waitFor(() => expect(screen.getByText('No API keys')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => expect(screen.getByText(created.key)).toBeInTheDocument());
    expect(screen.getByText(/only time the full key is shown/i)).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledWith({ kind: 'test' });
  });

  it('rotate calls the api and revoke calls the api', async () => {
    authAs('admin');
    mockedList.mockResolvedValue({ keys: [keyView()] });
    mockedRotate.mockResolvedValue({ ...keyView(), key: 'zios_test_NEW' });
    mockedRevoke.mockResolvedValue(keyView({ revokedAt: '2026-09-22T11:00:00Z' }));
    const user = userEvent.setup();
    render(<ApiKeysPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await waitFor(() => expect(mockedRotate).toHaveBeenCalledWith('key-1'));

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(mockedRevoke).toHaveBeenCalledWith('key-1'));
  });
});
