import { useState } from 'react';
import { Check, Code, Copy, ExternalLink, Globe, KeyRound, Radio, ReceiptText, Shield, Webhook, Zap } from 'lucide-react';
import { Button } from '../../components/Button';
import { StatusPill, useBackendHealth } from '../../components/ProductOps';
import { useToastStore } from '../../components/ToastContainer';
import { QANTARA_BACKEND_URL } from '../../lib/dealRoom';

export function CheckoutApi() {
  const { addToast } = useToastStore();
  const { health } = useBackendHealth();
  const [activeTab, setActiveTab] = useState<'sdk' | 'curl' | 'node' | 'intent' | 'return' | 'webhook' | 'webhookOps' | 'sse'>('sdk');
  const [copied, setCopied] = useState<string | null>(null);

  const api = QANTARA_BACKEND_URL;
  const copy = (id: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1400);
    addToast('success', 'Copied');
  };

  const snippets = {
    sdk: `import { randomBytes } from 'node:crypto';
import { toHex, zeroHash } from 'viem';
import { Qantara } from '@qie/qantara-sdk';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

const sdk = new Qantara({
  apiKey: required('QANTARA_API_KEY'),
  backendUrl: '${api}',
  frontendUrl: required('QANTARA_FRONTEND_URL'),
});

const salt = toHex(randomBytes(32));
const amount = required('QANTARA_AMOUNT');
const token = process.env.QANTARA_TOKEN ?? 'QIE';
const merchantAddress = required('QANTARA_MERCHANT_ADDRESS');
const createCall = sdk.invoices.buildCreateInvoiceCall({
  salt,
  amount,
  token,
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  metadataHash: zeroHash,
});

const chainTxHash = await walletClient.sendTransaction({
  account: merchantAddress,
  to: createCall.to,
  data: createCall.data,
});
await publicClient.waitForTransactionReceipt({ hash: chainTxHash });

const invoice = await sdk.invoices.create({
  merchant: merchantAddress,
  amount,
  token,
  title: process.env.QANTARA_TITLE,
  chainTxHash,
  webhookUrl: process.env.QANTARA_WEBHOOK_URL,
});

console.log(invoice.payUrl);`,
    curl: `# 1. Send createInvoice from the merchant wallet.
# 2. Wait for the chain receipt, then mirror the confirmed tx hash.
curl -X POST ${api}/v1/invoices \\
  -H "Authorization: Bearer $QANTARA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchant": "'"$QANTARA_MERCHANT_ADDRESS"'",
    "amount": "'"$QANTARA_AMOUNT"'",
    "token": "'"\${QANTARA_TOKEN:-QIE}"'",
    "title": "'"$QANTARA_TITLE"'",
    "memo": "'"$QANTARA_MEMO"'",
    "chain_tx_hash": "$CHAIN_TX_HASH",
    "webhook_url": "'"$QANTARA_WEBHOOK_URL"'"
  }'`,
    node: `import { randomBytes } from 'node:crypto';
import { toHex, zeroHash } from 'viem';
import { Qantara } from '@qie/qantara-sdk';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

const sdk = new Qantara({ backendUrl: '${api}' });
const salt = toHex(randomBytes(32));
const amount = required('QANTARA_AMOUNT');
const token = process.env.QANTARA_TOKEN ?? 'QIE';
const merchantAddress = required('QANTARA_MERCHANT_ADDRESS');
const createCall = sdk.invoices.buildCreateInvoiceCall({
  salt,
  amount,
  token,
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  metadataHash: zeroHash,
});

const chainTxHash = await walletClient.sendTransaction({
  account: merchantAddress,
  to: createCall.to,
  data: createCall.data,
});
await publicClient.waitForTransactionReceipt({ hash: chainTxHash });

const invoice = await fetch('${api}/v1/invoices', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + required('QANTARA_API_KEY'),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    merchant: merchantAddress,
    amount,
    token,
    title: process.env.QANTARA_TITLE,
    chain_tx_hash: chainTxHash,
    webhook_url: process.env.QANTARA_WEBHOOK_URL,
  }),
}).then((res) => res.json());

console.log(invoice.pay_url ?? invoice.url);`,
    intent: `const intent = await fetch('${api}/v1/payment-intents', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.QANTARA_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    invoice_hash: invoice.hash,
    ttl_seconds: 3600,
  }),
}).then((res) => res.json());

// Signed fields:
// amount, token, merchant, optional payer, deadline, invoice hash, nonce, backend signature
console.log(intent.intent.signature);`,
    return: `function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

// Include merchant return URLs when mirroring the verified on-chain invoice.
const invoice = await fetch('${api}/v1/invoices', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.QANTARA_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    merchant: process.env.QANTARA_MERCHANT_ADDRESS,
    amount: process.env.QANTARA_AMOUNT,
    token: process.env.QANTARA_TOKEN ?? 'QIE',
    chain_tx_hash: process.env.CHAIN_TX_HASH,
    webhook_url: process.env.QANTARA_WEBHOOK_URL,
    success_url: required('QANTARA_SUCCESS_URL'),
    cancel_url: required('QANTARA_CANCEL_URL'),
  }),
}).then((res) => res.json());

// Payers return through backend-gated URLs.
// Success redirects only after the invoice is Paid.
const successReturn = \`${api}/v1/invoices/\${invoice.hash}/return?type=success\`;
const cancelReturn = \`${api}/v1/invoices/\${invoice.hash}/return?type=cancel\`;

console.log({ payUrl: invoice.pay_url, successReturn, cancelReturn });`,
    webhook: `import crypto from 'node:crypto';

function verifyQantaraWebhook(req) {
  const timestamp = req.headers['x-qantara-timestamp'];
  const signature = req.headers['x-qantara-signature'];
  const body = req.rawBody.toString();
  const expected = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(\`\${timestamp}.\${body}\`)
    .digest('hex');

  const received = Buffer.from(signature, 'hex');
  const trusted = Buffer.from(expected, 'hex');
  if (received.length !== trusted.length || !crypto.timingSafeEqual(received, trusted)) {
    throw new Error('Bad signature');
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error('Stale webhook');
  }
  return JSON.parse(body);
}`,
    webhookOps: `# Webhook status and connectivity checks use Authorization headers.
curl -s ${api}/v1/webhooks/deliveries?invoice_hash=$QANTARA_INVOICE_HASH \\
  -H "Authorization: Bearer $QANTARA_API_KEY"

curl -X POST ${api}/v1/webhooks/test \\
  -H "Authorization: Bearer $QANTARA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"invoice_hash":"'"$QANTARA_INVOICE_HASH"'"}'

curl -X POST ${api}/v1/webhooks/deliveries/$QANTARA_DELIVERY_ID/retry \\
  -H "Authorization: Bearer $QANTARA_API_KEY"`,
    sse: `const invoiceHash = process.env.QANTARA_INVOICE_HASH;
const url = new URL(\`${api}/v1/invoices/\${invoiceHash}/events\`);

const stream = new EventSource(url);
stream.addEventListener('message.created', (event) => {
  console.log('chat event', JSON.parse(event.data));
});
stream.addEventListener('invoice.paid', (event) => {
  console.log('payment event', JSON.parse(event.data));
});
stream.addEventListener('receipt.created', (event) => {
  console.log('receipt event', JSON.parse(event.data));
});`,
  };

  const lifecycle = [
    'create on-chain',
    'share Qantara link',
    'chat on invoice',
    'payer pays',
    'verify via RPC',
    'receipt issued',
    'return gated by status',
    'webhook delivered',
    'SSE timeline updates',
  ];

  const describeEndpoint = (endpoint: string) => {
    if (endpoint.startsWith('GET /v1/settings/status')) return 'GET /v1/settings/status - merchant SIWE session or server API key';
    if (endpoint.startsWith('GET /v1/rails')) return 'GET /v1/rails - public payment rail catalog from backend configuration';
    if (endpoint.startsWith('GET /v1/payment-requirements')) return 'GET /v1/payment-requirements/:hash - backend payment requirement/debug data, no local fallback records';
    if (endpoint.startsWith('GET /v1/explorer/activity')) return 'GET /v1/explorer/activity - persisted public activity feed when explorer API is enabled';
    if (endpoint.startsWith('GET /v1/alerts/deliveries')) return 'GET /v1/alerts/deliveries - operator API key';
    if (endpoint.startsWith('POST /v1/alerts/dispatch')) return 'POST /v1/alerts/dispatch - operator API key';
    if (endpoint.startsWith('POST /v1/invoices')) return 'POST /v1/invoices - SIWE session, server API key, or wallet signature + chain tx';
    if (endpoint.startsWith('GET /v1/webhooks/deliveries')) return 'GET /v1/webhooks/deliveries - merchant SIWE session or server API key';
    if (endpoint.startsWith('POST /v1/webhooks/deliveries')) return 'POST /v1/webhooks/deliveries/:id/retry - merchant SIWE session or server API key';
    if (endpoint.startsWith('POST /v1/webhooks/test')) return 'POST /v1/webhooks/test - merchant SIWE session or server API key';
    if (endpoint.startsWith('POST /v1/webhooks/retry-due')) return 'POST /v1/webhooks/retry-due - operator API key';
    if (endpoint.startsWith('POST /v1/payment-intents')) return 'POST /v1/payment-intents - merchant SIWE session or server API key';
    if (endpoint.startsWith('GET /v1/payment-intents')) return 'GET /v1/payment-intents - merchant SIWE session or server API key';
    if (endpoint.startsWith('GET /v1/chain/status')) return 'GET /v1/chain/status - merchant SIWE session or server API key';
    if (endpoint.startsWith('POST /v1/chain/sync')) return 'POST /v1/chain/sync - chain:sync operator API key';
    if (endpoint.startsWith('GET /v1/invoices/:hash/events')) return 'GET /v1/invoices/:hash/events - JSON or SSE; Authorization header or invoice guest token when required';
    if (endpoint.startsWith('GET /v1/invoices/:hash/return')) return 'GET /v1/invoices/:hash/return?type=success|cancel - backend-gated merchant redirect; success requires Paid';
    return endpoint;
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill ok={!!health?.ok} label={health?.ok ? 'Backend online' : 'Backend unavailable'} />
          <StatusPill ok={!!health?.rpc?.ok} label={health?.rpc?.ok ? `QIE RPC block ${health.rpc.blockNumber}` : 'RPC check'} />
          <StatusPill ok={!!health?.indexer?.runtime?.enabled} label={health?.indexer?.runtime?.enabled ? 'Indexer running' : 'Indexer manual'} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Checkout API</h1>
        <p className="max-w-2xl text-sm text-text-secondary">
          Create the invoice on-chain first, mirror the tx through the merchant API, verify real QIE/QUSDC settlement, and receive HMAC webhooks.
          API keys stay in Authorization headers on trusted servers.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { icon: Zap, title: 'Invoices', body: 'Backend records with hosted pay links.' },
          { icon: KeyRound, title: 'API keys', body: 'Scoped merchant keys for integrations.' },
          { icon: Shield, title: 'Signed intents', body: 'Amount, token, merchant, deadline, signature.' },
          { icon: Webhook, title: 'Webhooks', body: 'Persisted delivery logs and retries metadata.' },
        ].map((item) => (
          <section key={item.title} className="rounded-2xl border border-border-default bg-surface-1 p-5">
            <item.icon className="mb-3 h-5 w-5 text-primary" />
            <h2 className="text-sm font-bold text-white">{item.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.body}</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-5">
        <div className="mb-4 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-bold text-white">API key scope guidance</h2>
            <p className="text-xs text-text-muted">Use the smallest merchant-scoped key for the server route that calls Qantara.</p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            ['Create checkout records', 'invoices:write'],
            ['Read checkout records and payment intents', 'invoices:read'],
            ['Read receipts', 'receipts:read'],
            ['Inspect webhook deliveries', 'webhooks:read'],
            ['Retry or test webhooks', 'webhooks:write'],
            ['Read chain event state', 'chain:read'],
            ['Run chain sync', 'chain:sync operator key'],
            ['Create child API keys', 'api_keys:write'],
          ].map(([label, scope]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-xs">
              <span className="text-text-secondary">{label}</span>
              <code className="text-primary">{scope}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Backend URL</div>
            <code className="text-sm text-white">{api}</code>
          </div>
          <Button variant="secondary" size="sm" onClick={() => copy('api', api)}>
            {copied === 'api' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy URL
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {lifecycle.map((step, index) => (
            <div key={step} className="rounded-xl bg-surface-2 p-3 text-xs">
              <Radio className="mb-2 h-3.5 w-3.5 text-primary" />
              <div className="text-text-muted">Step {index + 1}</div>
              <div className="mt-1 font-bold text-white">{step}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border-default">
          {([
            ['sdk', Code, 'SDK flow'],
            ['curl', Code, 'cURL'],
            ['node', Code, 'Node'],
            ['intent', Shield, 'Payment intent'],
            ['return', Globe, 'Return URLs'],
            ['webhook', Webhook, 'Webhook verify'],
            ['webhookOps', ReceiptText, 'Webhook status'],
            ['sse', Radio, 'SSE timeline'],
          ] as const).map(([id, Icon, label]) => (
            <button
              key={String(id)}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
                activeTab === id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label as string}
            </button>
          ))}
        </div>
        <div className="relative rounded-2xl border border-border-default bg-surface-1 p-5">
          <button
            onClick={() => copy(activeTab, snippets[activeTab])}
            className="absolute right-4 top-4 rounded-lg border border-border-default bg-surface-2 px-2.5 py-1.5 text-[10px] font-bold text-text-secondary hover:text-white"
          >
            {copied === activeTab ? 'Copied' : 'Copy'}
          </button>
          <pre className="overflow-x-auto pr-20 text-xs leading-relaxed text-text-secondary">
            <code>{snippets[activeTab]}</code>
          </pre>
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-5">
        <h2 className="mb-3 text-lg font-bold text-white">Operational endpoints</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            'GET /v1/health',
            'GET /v1/rails',
            'GET /v1/payment-requirements/:hash',
            'GET /v1/explorer/activity',
            'GET /v1/settings/status · API key',
            'GET /v1/metrics',
            'GET /v1/alerts/deliveries · API key',
            'POST /v1/alerts/dispatch · API key',
            'POST /v1/invoices · API key + chain tx',
            'POST /v1/invoices/:hash/refund/verify-contract',
            'POST /v1/invoices/:hash/cancel/verify',
            'POST /v1/invoices/:hash/pause/verify',
            'POST /v1/invoices/:hash/resume/verify',
            'GET /v1/invoices/:hash/events',
            'GET /v1/invoices/:hash/return?type=success',
            'GET /v1/invoices/:hash/return?type=cancel',
            'GET /v1/receipts/:hash',
            'POST /v1/webhooks/test - API key',
            'POST /v1/webhooks/retry-due - operator API key',
            'GET /v1/payment-intents - API key',
            'GET /v1/webhooks/deliveries · API key',
            'POST /v1/webhooks/deliveries/:id/retry · API key',
            'POST /v1/payment-intents · API key',
            'GET /v1/chain/status · API key',
            'GET /v1/chain/events?invoice_hash=:hash - merchant SIWE session or server API key',
            'POST /v1/chain/sync · API key',
          ].map((endpoint) => (
            <code key={endpoint} className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-secondary">{describeEndpoint(endpoint)}</code>
          ))}
        </div>
        <a href="/app/guide" className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-primary hover:underline">
          Integration guide <ExternalLink className="h-3 w-3" />
        </a>
      </section>
    </div>
  );
}
