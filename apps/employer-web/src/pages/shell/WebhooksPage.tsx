import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  replayWebhookDelivery,
  type CreatedWebhookEndpointView,
  type WebhookDeliveryStatus,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEvent,
} from '../../lib/webhooks-api';

/**
 * Webhooks — subscriber endpoints + delivery journal (FR-E13-4). Admin-only
 * mutations; interviewers can view. The signing secret is shown exactly once
 * at creation. Failed deliveries stay journaled and can be replayed.
 */

const EVENT_OPTIONS: WebhookEvent[] = ['interview.completed', 'report.ready'];
const STATUS_FILTERS: Array<WebhookDeliveryStatus | 'all'> = [
  'all',
  'pending',
  'delivered',
  'failed',
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SecretRevealModal({
  created,
  onClose,
}: {
  created: CreatedWebhookEndpointView;
  onClose: () => void;
}) {
  const { push: toast } = useToast();

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(created.secret);
      toast('Secret copied to clipboard', 'success');
    } catch {
      toast('Copy failed — select the secret manually', 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card padding="lg" className="w-full max-w-lg">
        <h3 className="font-headline-md text-headline-md text-primary">Webhook endpoint created</h3>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">
          This is the only time the signing secret is shown. Subscribers verify the{' '}
          <code className="text-sm">X-Zios-Signature</code> header against it.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-3">
          <code className="flex-1 break-all text-sm text-on-surface">{created.secret}</code>
          <button
            type="button"
            onClick={() => void copySecret()}
            className="shrink-0 text-primary hover:text-primary/80"
            aria-label="Copy secret"
          >
            <Icon name="content_copy" className="text-xl" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Card>
    </div>
  );
}

export function WebhooksPage() {
  const { state } = useAuth();
  const { push: toast } = useToast();
  const [endpoints, setEndpoints] = useState<WebhookEndpointView[] | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>(['interview.completed']);
  const [statusFilter, setStatusFilter] = useState<WebhookDeliveryStatus | 'all'>('all');
  const [reveal, setReveal] = useState<CreatedWebhookEndpointView | null>(null);
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';

  const reload = useCallback(async () => {
    try {
      const [endpointResult, deliveryResult] = await Promise.all([
        listWebhookEndpoints(),
        listWebhookDeliveries(statusFilter === 'all' ? undefined : { status: statusFilter }),
      ]);
      setEndpoints(endpointResult.endpoints);
      setDeliveries(deliveryResult.deliveries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    }
  }, [statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function toggleEvent(event: WebhookEvent) {
    setNewEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const created = await createWebhookEndpoint({ url: newUrl, events: newEvents });
      setReveal(created);
      setNewUrl('');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create endpoint', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeactivate(endpoint: WebhookEndpointView) {
    try {
      await deactivateWebhookEndpoint(endpoint.id);
      toast('Endpoint deactivated', 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to deactivate endpoint', 'error');
    }
  }

  async function handleReplay(delivery: WebhookDeliveryView) {
    try {
      await replayWebhookDelivery(delivery.id);
      toast('Delivery re-queued for replay', 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to replay delivery', 'error');
    }
  }

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Webhooks
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Push interview.completed and report.ready events to your systems — signed, journaled,
            retried.
          </p>
        </div>
      </section>

      {isAdmin && (
        <Card padding="lg" className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <div className="flex-1">
              <label
                htmlFor="webhook-url"
                className="block text-xs font-label-bold uppercase tracking-wider text-on-surface-variant mb-2"
              >
                Subscriber URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={newUrl}
                onChange={(event) => setNewUrl(event.target.value)}
                placeholder="https://partner.example.com/zios-webhook"
                className="w-full bg-surface-container-low border-none rounded-full px-4 py-2.5 text-on-surface font-body-md text-sm outline-none focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div>
              <span className="block text-xs font-label-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Events
              </span>
              <div className="flex items-center gap-4 px-1">
                {EVENT_OPTIONS.map((event) => (
                  <label key={event} className="flex items-center gap-2 text-sm text-on-surface">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(event)}
                      onChange={() => toggleEvent(event)}
                      className="accent-primary"
                    />
                    <code className="text-xs">{event}</code>
                  </label>
                ))}
              </div>
            </div>
            <Button
              onClick={() => void handleCreate()}
              disabled={creating || newUrl.trim().length === 0 || newEvents.length === 0}
            >
              {creating ? 'Creating…' : 'Add endpoint'}
            </Button>
          </div>
        </Card>
      )}

      <Card padding="none" className="overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-variant/50">
                {['URL', 'Events', 'Created', 'Status', ''].map((column) => (
                  <th
                    key={column}
                    className="px-6 py-4 text-xs font-label-bold uppercase tracking-wider text-on-surface-variant"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {error !== null && (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <p className="font-label-bold text-label-bold text-error">{error}</p>
                  </td>
                </tr>
              )}
              {error === null && endpoints === null && (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <p className="text-sm text-on-surface-variant">Loading…</p>
                  </td>
                </tr>
              )}
              {error === null && endpoints !== null && endpoints.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-16">
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                        <Icon name="webhook" className="text-2xl text-outline" />
                      </div>
                      <div>
                        <p className="font-label-bold text-label-bold text-primary">No endpoints</p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          {isAdmin
                            ? 'Add an endpoint above to start receiving signed events.'
                            : 'Ask an admin to configure a webhook endpoint.'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {endpoints?.map((endpoint) => (
                <tr
                  key={endpoint.id}
                  className="border-b border-surface-variant/30 last:border-none hover:bg-surface-container-low/50"
                >
                  <td className="px-6 py-4">
                    <code className="text-sm text-on-surface break-all">{endpoint.url}</code>
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {endpoint.events.map((event) => (
                      <code key={event} className="block text-xs">
                        {event}
                      </code>
                    ))}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {formatDateTime(endpoint.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    {endpoint.active ? (
                      <Badge tone="success" icon="check_circle">
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="error" icon="block">
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {isAdmin && endpoint.active && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(endpoint)}
                        className="text-error hover:text-error/80 text-sm font-label-bold"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="mb-4 flex items-center justify-between gap-4">
        <h3 className="font-headline-md text-headline-md text-primary">Delivery log</h3>
        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as WebhookDeliveryStatus | 'all')
          }
          className="bg-surface-container-low border-none rounded-full px-4 py-2 text-on-surface font-body-md text-sm outline-none focus:ring-2 focus:ring-primary/10"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {filter === 'all' ? 'All statuses' : filter}
            </option>
          ))}
        </select>
      </section>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-variant/50">
                {['Event', 'Status', 'Attempts', 'Last response', 'Last error', 'Created', ''].map(
                  (column) => (
                    <th
                      key={column}
                      className="px-6 py-4 text-xs font-label-bold uppercase tracking-wider text-on-surface-variant"
                    >
                      {column}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="text-sm text-on-surface-variant">No deliveries yet.</p>
                  </td>
                </tr>
              )}
              {deliveries.map((delivery) => (
                <tr
                  key={delivery.id}
                  className="border-b border-surface-variant/30 last:border-none hover:bg-surface-container-low/50"
                >
                  <td className="px-6 py-4">
                    <code className="text-xs text-on-surface">{delivery.event}</code>
                  </td>
                  <td className="px-6 py-4">
                    {delivery.status === 'delivered' && (
                      <Badge tone="success" icon="check_circle">
                        Delivered
                      </Badge>
                    )}
                    {delivery.status === 'pending' && <Badge tone="primary">Pending</Badge>}
                    {delivery.status === 'failed' && (
                      <Badge tone="error" icon="error">
                        Failed
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {delivery.attempts}
                    {delivery.deliveredAt && (
                      <span className="block text-xs">
                        at {formatDateTime(delivery.deliveredAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {delivery.lastResponseCode ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant max-w-56 truncate">
                    {delivery.lastError ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {formatDateTime(delivery.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    {isAdmin && delivery.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => void handleReplay(delivery)}
                        className="text-primary hover:text-primary/80 text-sm font-label-bold"
                      >
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {reveal && <SecretRevealModal created={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
}
