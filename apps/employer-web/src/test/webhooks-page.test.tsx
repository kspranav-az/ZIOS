import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebhooksPage } from '../pages/shell/WebhooksPage';
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  replayWebhookDelivery,
} from '../lib/webhooks-api';
import type { WebhookDeliveryView, WebhookEndpointView } from '../lib/webhooks-api';

vi.mock('../lib/webhooks-api', () => ({
  listWebhookEndpoints: vi.fn(),
  createWebhookEndpoint: vi.fn(),
  deactivateWebhookEndpoint: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  replayWebhookDelivery: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}));

import { useAuth } from '../auth/AuthContext';

const mockedListEndpoints = vi.mocked(listWebhookEndpoints);
const mockedCreate = vi.mocked(createWebhookEndpoint);
const mockedDeactivate = vi.mocked(deactivateWebhookEndpoint);
const mockedListDeliveries = vi.mocked(listWebhookDeliveries);
const mockedReplay = vi.mocked(replayWebhookDelivery);
const mockedUseAuth = vi.mocked(useAuth);

function endpointView(overrides: Partial<WebhookEndpointView> = {}): WebhookEndpointView {
  return {
    id: 'endpoint-1',
    orgId: 'org-1',
    url: 'https://partner.example.com/hook',
    events: ['interview.completed', 'report.ready'],
    active: true,
    createdAt: '2026-09-22T10:00:00Z',
    ...overrides,
  };
}

function deliveryView(overrides: Partial<WebhookDeliveryView> = {}): WebhookDeliveryView {
  return {
    id: 'delivery-1',
    endpointId: 'endpoint-1',
    sessionEventId: 'event-1',
    event: 'interview.completed',
    status: 'failed',
    attempts: 5,
    nextAttemptAt: '2026-09-22T10:05:00Z',
    lastResponseCode: 500,
    lastError: 'subscriber returned 500',
    deliveredAt: null,
    createdAt: '2026-09-22T10:00:00Z',
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
  mockedListDeliveries.mockResolvedValue({ deliveries: [] });
});

describe('WebhooksPage', () => {
  it('lists endpoints and deliveries with admin actions for admins', async () => {
    authAs('admin');
    mockedListEndpoints.mockResolvedValue({ endpoints: [endpointView()] });
    mockedListDeliveries.mockResolvedValue({ deliveries: [deliveryView()] });
    render(<WebhooksPage />);

    await waitFor(() =>
      expect(screen.getByText('https://partner.example.com/hook')).toBeInTheDocument(),
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('subscriber returned 500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
  });

  it('hides mutations for interviewers and shows the empty-state hint', async () => {
    authAs('interviewer');
    mockedListEndpoints.mockResolvedValue({ endpoints: [] });
    render(<WebhooksPage />);

    await waitFor(() => expect(screen.getByText('No endpoints')).toBeInTheDocument());
    expect(screen.getByText('Ask an admin to configure a webhook endpoint.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add endpoint' })).not.toBeInTheDocument();
  });

  it('reveals the signing secret exactly once after creation', async () => {
    authAs('admin');
    mockedListEndpoints.mockResolvedValue({ endpoints: [] });
    mockedCreate.mockResolvedValue({
      endpoint: endpointView(),
      secret: 'whsec_FULLSECRETMATERIAL',
    });
    const user = userEvent.setup();
    render(<WebhooksPage />);

    await waitFor(() => expect(screen.getByText('No endpoints')).toBeInTheDocument());
    await user.type(
      screen.getByLabelText('Subscriber URL'),
      'https://partner.example.com/new-hook',
    );
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));

    await waitFor(() => expect(screen.getByText('whsec_FULLSECRETMATERIAL')).toBeInTheDocument());
    expect(screen.getByText(/only time the signing secret is shown/i)).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledWith({
      url: 'https://partner.example.com/new-hook',
      events: ['interview.completed'],
    });
  });

  it('deactivate and replay call the api', async () => {
    authAs('admin');
    mockedListEndpoints.mockResolvedValue({ endpoints: [endpointView()] });
    mockedListDeliveries.mockResolvedValue({ deliveries: [deliveryView()] });
    mockedDeactivate.mockResolvedValue({ ok: true });
    mockedReplay.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<WebhooksPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(mockedReplay).toHaveBeenCalledWith('delivery-1'));

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(mockedDeactivate).toHaveBeenCalledWith('endpoint-1'));
  });
});
