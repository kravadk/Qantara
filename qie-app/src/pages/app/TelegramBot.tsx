import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Webhook,
  Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { QANTARA_BACKEND_URL } from '../../lib/dealRoom';
import {
  getSettingsStatus,
  hasMerchantAuth,
  isFailedWebhookDelivery,
  telegramSetupItems,
  type SettingsStatus,
  type TelegramSetupItem,
} from '../../lib/qantaraApi';

export function TelegramBot() {
  const { addToast } = useToastStore();
  const [copied, setCopied] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const merchantAuthReady = hasMerchantAuth();
  const botUsername = ((import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) ?? '').replace(/^@/, '');
  const botUrl = botUsername ? `https://t.me/${botUsername}` : '';

  const copy = (id: string, text: string, label = 'Copied') => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
    addToast('success', label);
  };

  const loadSettingsStatus = useCallback(async () => {
    if (!merchantAuthReady) {
      setSettingsStatus(null);
      setSettingsError(null);
      setSettingsLoading(false);
      return;
    }
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      setSettingsStatus(await getSettingsStatus());
    } catch (err) {
      setSettingsStatus(null);
      setSettingsError(err instanceof Error ? err.message : 'Unable to load authenticated settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [merchantAuthReady]);

  useEffect(() => {
    void loadSettingsStatus();
  }, [loadSettingsStatus]);

  const readiness = telegramSetupItems(settingsStatus, merchantAuthReady);
  const readyCount = readiness.filter((item) => item.ok).length;
  const operational = settingsStatus?.operational;
  const recentFailures = operational?.webhooks.recentFailures ?? settingsStatus?.webhooks.stats?.recentFailures ?? [];
  const failedRecentCount = recentFailures.filter(isFailedWebhookDelivery).length;

  const setupSteps = useMemo(() => ([
    {
      title: 'Provision bot runtime',
      body: 'Set BOT_TOKEN and QANTARA_BACKEND_URL for the bot process. Set VITE_TELEGRAM_BOT_USERNAME only when this frontend should expose a direct Telegram link.',
      icon: MessageCircle,
    },
    {
      title: 'Use a bounded API key',
      body: 'QANTARA_API_KEY must allow telegram:write, invoices:read, and invoices:write for the merchant invoices the bot can link.',
      icon: KeyRound,
    },
    {
      title: 'Enable signed event delivery',
      body: 'WEBHOOK_SECRET must match between backend webhook signing and the bot receiver before payment, receipt, and message notifications are trusted.',
      icon: Webhook,
    },
    {
      title: 'Wire operational alerts',
      body: 'Set ALERT_CHAT_ID on the bot and configure backend ALERT_WEBHOOK_URL plus ALERT_WEBHOOK_SECRET for RPC, indexer, and webhook health alerts.',
      icon: Bell,
    },
  ]), []);

  const commands = [
    { cmd: '/link <invoiceHash>', desc: 'Link an existing merchant invoice to this Telegram chat' },
    { cmd: '/status <invoiceHash>', desc: 'Read backend status for a linked invoice' },
    { cmd: '/chat <invoiceHash>', desc: 'Show recent persisted deal-room messages' },
    { cmd: '/reply <invoiceHash> <message>', desc: 'Write a merchant reply into the deal room' },
    { cmd: '/notify_test', desc: 'Check backend, DB, RPC, bot API key access, and receiver setup' },
    { cmd: '/list', desc: 'Show invoices linked to this chat' },
    { cmd: '/help', desc: 'Show command reference' },
  ];

  const flow = [
    ['Create', 'Merchant creates the invoice in the wallet-backed app flow'],
    ['Link', 'Bot stores invoice-to-chat routing through the backend Telegram API'],
    ['Verify', 'Backend verifies payment with QIE RPC and persisted settlement records'],
    ['Notify', 'Backend signs message, payment, and receipt events for the bot receiver'],
    ['Reply', 'Merchant replies from Telegram into the persisted deal-room thread'],
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            Merchant operations
          </span>
          <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-400">
            Backend verified events
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
          <span className="qie-gradient-text">Telegram</span> setup
        </h1>
        <p className="max-w-3xl text-text-secondary">
          Link wallet-created Qantara links to Telegram chats, relay persisted deal-room replies, and receive signed payment, receipt, message, and alert events from the backend.
        </p>
      </div>

      {!merchantAuthReady && (
        <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-300">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-bold text-white">Authenticated settings are unavailable</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Sign in with the merchant wallet to show backend readiness, webhook state, and alert setup for this merchant deployment.
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy('auth-url', `${QANTARA_BACKEND_URL}/v1/auth/nonce`, 'Auth URL copied')}>
              <Copy className="h-4 w-4" /> Copy auth URL
            </Button>
          </div>
        </section>
      )}

      <section className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col items-center justify-center space-y-4 rounded-2xl border border-border-default bg-surface-1 p-6 text-center">
          {botUrl ? (
            <>
              <div className="rounded-2xl bg-white p-4">
                <QRCodeSVG value={botUrl} size={180} bgColor="#ffffff" fgColor="#0d0a18" />
              </div>
              <div>
                <div className="text-lg font-bold">@{botUsername}</div>
                <div className="mt-1 text-xs text-text-muted">Frontend bot username is configured</div>
              </div>
              <a href={botUrl} target="_blank" rel="noreferrer">
                <Button variant="primary" className="gap-2">
                  <MessageCircle className="h-4 w-4" /> Open Telegram <ExternalLink className="h-3 w-3" />
                </Button>
              </a>
            </>
          ) : (
            <>
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-border-default bg-surface-2">
                <MessageCircle className="h-10 w-10 text-text-muted" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">Bot link not exposed</div>
                <div className="mt-1 max-w-xs text-xs text-text-muted">
                  Set VITE_TELEGRAM_BOT_USERNAME in the frontend build to show a direct Telegram link and QR code.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border-default bg-surface-1 p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Readiness from backend
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {settingsError ? `Settings request failed: ${settingsError}` : `${readyCount}/${readiness.length} setup checks passing`}
              </p>
            </div>
            <Button variant="secondary" size="sm" className="gap-2" loading={settingsLoading} onClick={() => void loadSettingsStatus()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {readiness.map((item) => <ReadinessTile key={item.label} item={item} />)}
            <ReadinessTile
              item={{
                label: 'Webhook delivery',
                value: !merchantAuthReady
                  ? 'auth required'
                  : settingsLoading
                    ? 'loading authenticated status'
                    : `${operational?.webhooks.totalDeliveries ?? settingsStatus?.webhooks.stats?.totalDeliveries ?? 0} deliveries, ${failedRecentCount} recent failures`,
                ok: Boolean(merchantAuthReady && !failedRecentCount && settingsStatus?.webhooks.signingConfigured),
              }}
            />
            <ReadinessTile
              item={{
                label: 'RPC verification',
                value: !merchantAuthReady
                  ? 'auth required'
                  : operational?.rpcVerification.healthy
                    ? 'healthy'
                    : `${operational?.rpcVerification.failures24h ?? 0} failures in 24h`,
                ok: Boolean(operational?.rpcVerification.healthy),
              }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {setupSteps.map(({ title, body, icon: Icon }) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-border-default bg-surface-1 p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-white">{title}</h2>
            </div>
            <p className="text-sm text-text-secondary">{body}</p>
          </motion.div>
        ))}
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">API and webhook endpoints</h2>
            <p className="text-xs text-text-muted">Use Authorization headers for API keys. Keep signed webhook secrets only on servers.</p>
          </div>
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy('api-base', QANTARA_BACKEND_URL || 'VITE_QANTARA_BACKEND_URL=', 'API base copied')}>
            <Copy className="h-4 w-4" /> Copy API base
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ['Telegram links', 'POST /v1/telegram/links', 'telegram:write'],
            ['Read link state', 'GET /v1/telegram/links/:hash', 'telegram:write'],
            ['Invoice reads', 'GET /v1/invoices/:hash', 'invoices:read'],
            ['Receipt lookup', 'GET /v1/receipts/:hash', 'shareable endpoint'],
            ['Webhook delivery log', 'GET /v1/webhooks/deliveries', 'webhooks:read'],
            ['Operational status', 'GET /v1/settings/status', 'ops:read'],
          ].map(([label, endpoint, scope]) => (
            <div key={endpoint} className="rounded-xl border border-border-default bg-surface-2 p-4">
              <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
              <div className="mt-1 font-mono text-xs text-white">{endpoint}</div>
              <div className="mt-2 w-fit rounded bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary">{scope}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold text-white">Runtime command surface</h2>
        </div>
        <div className="divide-y divide-border-default rounded-2xl border border-border-default">
          {commands.map((command) => (
            <div key={command.cmd} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
              <code className="w-fit shrink-0 rounded bg-primary/10 px-2 py-1 font-mono text-xs text-primary">{command.cmd}</code>
              <span className="text-sm text-text-secondary">{command.desc}</span>
              <button
                onClick={() => copy(command.cmd, command.cmd, 'Command copied')}
                className="ml-auto w-fit shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                aria-label="Copy command"
              >
                {copied === command.cmd ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Event path</h2>
        <ol className="space-y-3 text-sm">
          {flow.map(([who, what], index) => (
            <li key={`${who}-${what}`} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{index + 1}</span>
              <div>
                <span className="font-bold text-white">{who}</span>
                <span className="text-text-secondary"> - {what}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className={`rounded-2xl border p-4 text-xs ${readyCount === readiness.length && !failedRecentCount ? 'border-primary/20 bg-primary/8 text-primary' : 'border-yellow-500/20 bg-yellow-500/5 text-yellow-100/80'}`}>
        <div className="flex items-start gap-3">
          {readyCount === readiness.length && !failedRecentCount ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-200" />
          )}
          <div>
            <span className="font-bold">Source of truth:</span>{' '}
            Bot readiness is derived from authenticated backend settings. Payment and receipt alerts are trusted only when backend signing is configured and invoice settlement is verified by QIE RPC or indexed invoice events.
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadinessTile({ item }: { item: TelegramSetupItem }) {
  return (
    <div className="min-w-0 rounded-xl border border-border-default bg-surface-2 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-widest text-text-muted">{item.label}</div>
        {item.ok ? <Check className="h-3.5 w-3.5 text-primary" /> : <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />}
      </div>
      <div className={`truncate text-sm font-bold ${item.ok ? 'text-primary' : 'text-yellow-300'}`}>{item.value}</div>
    </div>
  );
}
