import { AlertTriangle, CheckCircle, Copy, KeyRound, RefreshCw, RotateCw, Send, ShieldCheck, Webhook } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import {
  getWebhookSecret,
  hasMerchantAuth,
  isFailedWebhookDelivery,
  listWebhookDeliveries,
  retryWebhookDelivery,
  rotateWebhookSecret,
  testWebhookDelivery,
  type WebhookDeliveryRecord,
  type WebhookSigningSecret,
} from '../../lib/api/webhooksApi';

const verifySnippet = `import crypto from 'node:crypto';

export function verifyQantaraWebhook(req, secret) {
  const timestamp = req.headers['x-qantara-timestamp'];
  const signature = req.headers['x-qantara-signature'];
  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}`;

export function Webhooks() {
  const { addToast } = useToastStore();
  const merchantAuthReady = hasMerchantAuth();
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [secret, setSecret] = useState<WebhookSigningSecret | null>(null);
  const [invoiceHash, setInvoiceHash] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const failed = deliveries.filter(isFailedWebhookDelivery);
    const success = deliveries.filter((delivery) => delivery.status >= 200 && delivery.status < 300);
    const due = deliveries.filter((delivery) => delivery.nextRetryAt && delivery.nextRetryAt <= Math.floor(Date.now() / 1000));
    return { total: deliveries.length, failed: failed.length, success: success.length, due: due.length };
  }, [deliveries]);

  const load = useCallback(async () => {
    if (!merchantAuthReady) {
      setDeliveries([]);
      setSecret(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [deliveryResult, signingSecret] = await Promise.all([
        listWebhookDeliveries({ limit: 100 }),
        getWebhookSecret().catch(() => null),
      ]);
      setDeliveries(deliveryResult.deliveries);
      setSecret(signingSecret);
    } catch (err) {
      setDeliveries([]);
      setError(err instanceof Error ? err.message : 'Webhook console unavailable');
    } finally {
      setIsLoading(false);
    }
  }, [merchantAuthReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    addToast('success', `${label} copied`);
  };

  const retry = async (deliveryId: string) => {
    setBusyId(deliveryId);
    try {
      const result = await retryWebhookDelivery(deliveryId);
      setDeliveries((items) => items.map((item) => item.id === deliveryId ? result.delivery : item));
      addToast('success', 'Webhook retry submitted');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Webhook retry failed');
    } finally {
      setBusyId(null);
    }
  };

  const rotateSecret = async () => {
    setBusyId('secret');
    try {
      setSecret(await rotateWebhookSecret());
      addToast('success', 'Webhook signing secret rotated');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Secret rotation failed');
    } finally {
      setBusyId(null);
    }
  };

  const testDelivery = async () => {
    const hash = invoiceHash.trim();
    if (!hash) {
      addToast('warning', 'Enter an invoice hash with a configured webhook URL');
      return;
    }
    setBusyId('test');
    try {
      const result = await testWebhookDelivery(hash);
      setDeliveries((items) => {
        const merged = new Map(items.map((item) => [item.id, item]));
        for (const delivery of result.deliveries) merged.set(delivery.id, delivery);
        return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
      });
      addToast('success', 'Webhook test dispatched');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Webhook test failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">Webhook Console</h1>
          <p className="mt-1 text-text-secondary">Persisted delivery log, retries, signing secret, and endpoint test flow.</p>
        </div>
        <Button variant="secondary" className="gap-2" loading={isLoading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {!merchantAuthReady && (
        <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-6">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-yellow-300" />
            <div>
              <h2 className="font-bold text-white">Merchant sign-in required</h2>
              <p className="mt-1 text-sm text-text-secondary">Webhook logs and signing secrets are merchant-scoped backend resources. Sign in with the merchant wallet first.</p>
            </div>
          </div>
        </section>
      )}

      {error && (
        <section className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-300">
          {error}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <Stat label="Deliveries" value={summary.total} icon={Webhook} />
        <Stat label="Succeeded" value={summary.success} icon={CheckCircle} tone="good" />
        <Stat label="Failed" value={summary.failed} icon={AlertTriangle} tone={summary.failed > 0 ? 'warn' : 'default'} />
        <Stat label="Due retry" value={summary.due} icon={RotateCw} tone={summary.due > 0 ? 'warn' : 'default'} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Panel icon={ShieldCheck} title="Signing secret">
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">Merchant</div>
            <div className="mt-1 truncate font-mono text-sm font-bold text-white">{secret?.merchant ?? 'auth required'}</div>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">Secret</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="min-w-0 truncate text-sm font-bold text-primary">{secret?.secret ?? 'unavailable'}</code>
              {secret?.secret && (
                <button type="button" className="shrink-0 text-text-muted hover:text-primary" onClick={() => void copy(secret.secret, 'Webhook secret')}>
                  <Copy className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Created" value={secret ? new Date(secret.createdAt * 1000).toLocaleString() : '-'} />
            <Info label="Rotated" value={secret?.rotatedAt ? new Date(secret.rotatedAt * 1000).toLocaleString() : 'never'} />
          </div>
          <Button variant="danger" size="sm" className="gap-2" loading={busyId === 'secret'} disabled={!merchantAuthReady} onClick={() => void rotateSecret()}>
            <RotateCw className="h-4 w-4" /> Rotate secret
          </Button>
        </Panel>

        <Panel icon={Send} title="Test delivery">
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <label className="text-[10px] uppercase tracking-widest text-text-muted">Invoice hash</label>
            <input
              value={invoiceHash}
              onChange={(event) => setInvoiceHash(event.target.value)}
              placeholder="0x..."
              className="mt-2 h-11 w-full rounded-xl border border-border-default bg-surface-1 px-3 font-mono text-sm text-white outline-none placeholder:text-text-dim focus:border-primary"
            />
          </div>
          <Button size="sm" className="gap-2" loading={busyId === 'test'} disabled={!merchantAuthReady} onClick={() => void testDelivery()}>
            <Send className="h-4 w-4" /> Test webhook delivery
          </Button>
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-widest text-text-muted">Signature verification snippet</div>
              <button type="button" className="text-text-muted hover:text-primary" onClick={() => void copy(verifySnippet, 'Verify snippet')}>
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <pre className="max-h-48 overflow-auto rounded-xl bg-bg-base p-3 text-[10px] text-text-secondary">{verifySnippet}</pre>
          </div>
        </Panel>
      </section>

      <Panel icon={Webhook} title="Delivery log">
        {deliveries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-10 text-center text-sm text-text-muted">
            No persisted webhook deliveries for this merchant scope yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border-default">
            {deliveries.map((delivery) => (
              <DeliveryRow key={delivery.id} delivery={delivery} busy={busyId === delivery.id} onRetry={() => void retry(delivery.id)} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Webhook; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border-default bg-surface-1 p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone = 'default' }: { icon: typeof Webhook; label: string; value: number; tone?: 'default' | 'good' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === 'good' ? 'text-primary' : tone === 'warn' ? 'text-yellow-300' : 'text-text-muted'}`} />
        <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${tone === 'good' ? 'text-primary' : tone === 'warn' ? 'text-yellow-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function DeliveryRow({ delivery, busy, onRetry }: { delivery: WebhookDeliveryRecord; busy: boolean; onRetry: () => void }) {
  const failed = isFailedWebhookDelivery(delivery);
  const [open, setOpen] = useState(false);
  const hasPayload = !!delivery.eventPayload && Object.keys(delivery.eventPayload).length > 0;
  return (
    <div className="border-b border-border-default bg-surface-2 p-4 last:border-b-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${failed ? 'bg-red-500/10 text-red-300' : 'bg-primary/10 text-primary'}`}>
              {delivery.status || 'network'}
            </span>
            <span className="text-sm font-bold text-white">{delivery.eventType}</span>
            <span className="text-xs text-text-muted">attempt {delivery.attempts}</span>
          </div>
          <div className="mt-2 truncate font-mono text-xs text-text-muted">{delivery.invoiceHash}</div>
          {delivery.targetUrl && <div className="mt-1 truncate text-xs text-text-secondary">{delivery.targetUrl}</div>}
          {delivery.lastError && <div className="mt-1 truncate text-xs text-yellow-200">{delivery.lastError}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasPayload && (
            <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide payload' : 'Payload'}
            </Button>
          )}
          {delivery.nextRetryAt && (
            <span className="rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-xs text-text-muted">
              retry {new Date(delivery.nextRetryAt * 1000).toLocaleTimeString()}
            </span>
          )}
          <Button variant="secondary" size="sm" loading={busy} disabled={!failed} onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
      {open && hasPayload && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-border-default bg-surface-1 p-3 text-[11px] leading-relaxed text-text-secondary">
          {JSON.stringify(delivery.eventPayload, null, 2)}
        </pre>
      )}
    </div>
  );
}
