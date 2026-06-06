import { Code2, Copy, CreditCard, ExternalLink, Globe, Play, Webhook, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import { StatusPill, useBackendHealth } from '../../components/ProductOps';
import { QANTARA_BACKEND_URL } from '../../lib/dealRoom';
import { BuildSidebarPanels, Field } from './build/BuildPanels';

type Tab = 'sdk' | 'rest' | 'button' | 'contract' | 'webhook';

const SNIPPETS: Record<Tab, string> = {
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
  backendUrl: '${QANTARA_BACKEND_URL}',
  frontendUrl: required('QANTARA_FRONTEND_URL'),
});

const amount = required('QANTARA_AMOUNT');
const token = process.env.QANTARA_TOKEN ?? 'QUSDC';
const merchantAddress = required('QANTARA_MERCHANT_ADDRESS');
const createCall = sdk.invoices.buildCreateInvoiceCall({
  salt: toHex(randomBytes(32)),
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

window.location.href = invoice.payUrl;`,
  rest: `# First submit createInvoice from the merchant wallet.
# Then mirror the confirmed transaction hash through the merchant API.
curl -X POST ${QANTARA_BACKEND_URL}/v1/invoices \\
  -H "Authorization: Bearer $QANTARA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "'"$QANTARA_AMOUNT"'",
    "token": "'"\${QANTARA_TOKEN:-QUSDC}"'",
    "merchant": "'"$QANTARA_MERCHANT_ADDRESS"'",
    "title": "'"$QANTARA_TITLE"'",
    "chain_tx_hash": "$CHAIN_TX_HASH",
    "webhook_url": "'"$QANTARA_WEBHOOK_URL"'"
  }'`,
  button: `<a
  href="https://qantara.app/pay/{invoice_hash}"
  data-qantara-pay-button
  style="display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 18px;border-radius:999px;background:#B9FF27;color:#041412;font-weight:700;text-decoration:none;"
>
  Pay with QIE
</a>

<script>
  document.querySelectorAll('[data-qantara-pay-button]').forEach((button) => {
    button.addEventListener('click', () => {
      // Hosted checkout opens the real invoice record. Paid state appears only after QIE RPC verification.
    });
  });
</script>`,
  contract: `import { parseUnits, zeroAddress } from 'viem';

const amount = process.env.QANTARA_AMOUNT;
if (!amount) throw new Error('QANTARA_AMOUNT is required');

await walletClient.writeContract({
  address: QANTARA_ADDRESS,
  abi: qantaraAbi,
  functionName: 'createInvoice',
  args: [
    salt,
    zeroAddress, // native QIE. Use QUSDC address for stablecoin.
    parseUnits(amount, 18),
    BigInt(Math.floor(Date.now() / 1000) + 86400),
    metadataHash,
  ],
});`,
  webhook: `import crypto from 'node:crypto';

export function verifyQantaraWebhook(req) {
  const timestamp = req.headers['x-qantara-timestamp'];
  const signature = req.headers['x-qantara-signature'];
  const body = req.rawBody;

  const expected = crypto
    .createHmac('sha256', process.env.QANTARA_WEBHOOK_SECRET)
    .update(\`\${timestamp}.\${body}\`)
    .digest('hex');

  const received = Buffer.from(signature, 'hex');
  const trusted = Buffer.from(expected, 'hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  return fresh && received.length === trusted.length && crypto.timingSafeEqual(received, trusted);
}`,
};

export function Build() {
  const { addToast } = useToastStore();
  const { health } = useBackendHealth();
  const [activeTab, setActiveTab] = useState<Tab>('rest');
  const [builder, setBuilder] = useState({ invoiceHash: '', accent: '#F02C78' });

  const iframeSnippet = useMemo(() => {
    const hash = builder.invoiceHash.trim() || '{invoice_hash}';
    return `<iframe
  src="https://qantara.app/checkout/${hash}"
  width="420"
  height="640"
  style="border:0;border-radius:12px;max-width:100%;"
  allow="clipboard-write"
></iframe>`;
  }, [builder.invoiceHash]);

  const copy = (text: string, label = 'Snippet') => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Build</h1>
          <p className="text-text-secondary mt-1">SDK, REST, contract calls, embeds, and webhook verification.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill ok={!!health?.ok} label={health?.ok ? 'Backend online' : 'Backend unavailable'} />
            <span className="rounded-full border border-border-default bg-surface-1 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
              {QANTARA_BACKEND_URL}
            </span>
          </div>
        </div>
        <a href={qieMainnet.blockExplorers.default.url} target="_blank" rel="noreferrer">
          <Button variant="secondary" className="gap-2">
            <ExternalLink className="w-4 h-4" /> QIE Explorer
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <section className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
          <div className="flex flex-wrap gap-2 p-4 border-b border-border-default">
            {([
              ['sdk', 'JS SDK', Code2],
              ['rest', 'REST API', Globe],
              ['button', 'Payment Button', CreditCard],
              ['contract', 'Direct Contract', Wrench],
              ['webhook', 'Webhook HMAC', Webhook],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold border transition-colors ${
                  activeTab === id
                    ? 'bg-primary text-black border-primary'
                    : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="relative bg-black">
            <button
              onClick={() => copy(SNIPPETS[activeTab])}
              className="absolute top-4 right-4 p-2 rounded-lg bg-surface-2 border border-border-default text-text-muted hover:text-primary"
              title="Copy snippet"
            >
              <Copy className="w-4 h-4" />
            </button>
            <pre className="p-6 pt-14 min-h-[420px] text-sm text-text-secondary overflow-x-auto">
              <code>{SNIPPETS[activeTab]}</code>
            </pre>
          </div>
        </section>

        <BuildSidebarPanels />
      </div>

      <section className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Play className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-white">Hosted Checkout Embed</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <div className="space-y-4">
            <Field label="Invoice hash" value={builder.invoiceHash} onChange={(invoiceHash) => setBuilder({ ...builder, invoiceHash })} />
            <label className="space-y-2 block">
              <span className="text-[10px] uppercase tracking-widest text-text-muted">Accent</span>
              <input
                type="color"
                value={builder.accent}
                onChange={(e) => setBuilder({ ...builder, accent: e.target.value })}
                className="w-full h-11 rounded-full bg-surface-2 border border-border-default"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border-default bg-surface-2 p-5">
              <div className="text-[10px] uppercase tracking-widest text-text-muted mb-4">Preview</div>
              <div className="rounded-xl bg-bg-base border border-border-default p-5 space-y-4">
                <div className="text-sm text-text-secondary">Hosted checkout</div>
                <code className="block truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-secondary">
                  /checkout/{builder.invoiceHash.trim() || '{invoice_hash}'}
                </code>
                <button
                  style={{ backgroundColor: builder.accent }}
                  className="w-full h-11 rounded-full text-black text-sm font-bold"
                >
                  Open checkout
                </button>
              </div>
            </div>
            <div className="relative rounded-2xl border border-border-default bg-black overflow-hidden">
              <button onClick={() => copy(iframeSnippet, 'Iframe')} className="absolute top-3 right-3 p-2 rounded-lg bg-surface-2 text-text-muted hover:text-primary">
                <Copy className="w-4 h-4" />
              </button>
              <pre className="p-5 pt-14 text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap">
                <code>{iframeSnippet}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
