import { Download, Github, Package } from 'lucide-react';
import { CodeBlock } from '../../components/CodeBlock';

const INSTALL = `npm install @qie/qantara-sdk
# peer deps
npm install viem`;

const QUICKSTART = `import { randomBytes } from 'node:crypto';
import { toHex, zeroHash } from 'viem';
import { Qantara } from '@qie/qantara-sdk';

const sdk = new Qantara({
  apiKey: process.env.QANTARA_API_KEY,
  backendUrl: 'https://api.qantara.app',
  frontendUrl: 'https://qantara.app',
});

const salt = toHex(randomBytes(32));
const createCall = sdk.invoices.buildCreateInvoiceCall({
  salt,
  amount: '0.5',
  token: 'QIE',
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
  amount: '0.5',
  token: 'QIE',
  memo: 'Coffee',
  chainTxHash,
});

console.log(invoice.payUrl);
// open the URL in a browser, or convert to QR / EIP-681 deeplink.`;

const LIFECYCLE_EXAMPLE = `// State changes are verified against real chain transactions.
await sdk.invoices.verifyPayment(invoice.hash, {
  payer: payerAddress,
  txHash: paymentTxHash,
});

const pauseCall = sdk.invoices.buildPauseInvoiceCall(invoice.hash);
const pauseTxHash = await walletClient.sendTransaction({
  account: merchantAddress,
  to: pauseCall.to,
  data: pauseCall.data,
});
await publicClient.waitForTransactionReceipt({ hash: pauseTxHash });
await sdk.invoices.verifyPause(invoice.hash, pauseTxHash);

const refundCall = sdk.invoices.buildRefundInvoiceCall(invoice.hash);
const refundTxHash = await walletClient.sendTransaction({
  account: merchantAddress,
  to: refundCall.to,
  data: refundCall.data,
  value: refundCall.value,
});
await publicClient.waitForTransactionReceipt({ hash: refundTxHash });
await sdk.invoices.verifyContractRefund(invoice.hash, refundTxHash);`;

const NOTIFICATIONS_EXAMPLE = `// Requires a merchant-scoped API key.
const { notifications } = await sdk.notifications.list({
  merchant: merchantAddress,
  limit: 25,
});

await sdk.notifications.markRead(notifications[0].id, merchantAddress);`;

const SPLIT_EXAMPLE = `// Self-custody: build calldata, your wallet signs and sends.
const call = sdk.splits.buildCreateCall(
  [recipientA, recipientB],
  [6000, 4000], // 60% / 40%
  controllerAddress,
  salt,
);
// signer.sendTransaction({ to: call.to, data: call.data, ... });`;

const STREAM_EXAMPLE = `// 0.0001 QIE/sec for 10 minutes
const call = sdk.streams.buildCreateNativeStreamCall(
  recipientAddress,
  100000000000000n,
  Math.floor(Date.now()/1000),
  Math.floor(Date.now()/1000) + 600,
);
// signer.sendTransaction({ to: call.to, data: call.data, value: call.value });`;

export function Sdk() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100">
        <Package className="h-5 w-5 text-indigo-400" /> @qie/qantara-sdk
      </h1>
      <p className="text-sm text-slate-400">
        TypeScript SDK for on-chain invoice creation, backend mirroring, verified lifecycle updates,
        notifications, splits, streams, and chat on QIE Mainnet.
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href="https://www.npmjs.com/package/@qie/qantara-sdk"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Download className="h-3 w-3" /> npm
        </a>
        <a
          href="https://github.com/your-org/qantara"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Github className="h-3 w-3" /> source
        </a>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Install</h2>
        <CodeBlock language="bash" code={INSTALL} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Quick start - create an invoice</h2>
        <CodeBlock language="typescript" code={QUICKSTART} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Lifecycle - verify chain transactions</h2>
        <CodeBlock language="typescript" code={LIFECYCLE_EXAMPLE} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Notifications - merchant operations</h2>
        <CodeBlock language="typescript" code={NOTIFICATIONS_EXAMPLE} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Splits - revenue sharing</h2>
        <CodeBlock language="typescript" code={SPLIT_EXAMPLE} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Streams - per-second payouts</h2>
        <CodeBlock language="typescript" code={STREAM_EXAMPLE} />
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-100">API keys</h2>
        <p className="mb-3 text-xs text-slate-400">
          API keys are issued from the Developer page once you sign in with your wallet.
          The hosted backend rate-limits per-key and never custodies funds.
        </p>
        <a
          href="/app/developer"
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
        >
          Get an API key
        </a>
      </section>
    </div>
  );
}
