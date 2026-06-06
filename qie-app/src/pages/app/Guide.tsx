import { BookOpen, CreditCard, HelpCircle, MonitorCog, ReceiptText, Search, ShieldCheck, Terminal, Webhook } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PAGES = [
  { id: 'getting-started', title: 'Getting Started', icon: BookOpen },
  { id: 'invoice-types', title: 'Invoice Types', icon: CreditCard },
  { id: 'accepting-payments', title: 'Accepting Payments', icon: CreditCard },
  { id: 'hosted-checkout', title: 'Hosted Checkout', icon: Webhook },
  { id: 'telegram-bot', title: 'Telegram Bot', icon: Terminal },
  { id: 'tax-receipts', title: 'Tax & Receipts', icon: ReceiptText },
  { id: 'operations', title: 'Operations', icon: MonitorCog },
  { id: 'security', title: 'Security', icon: ShieldCheck },
  { id: 'faq', title: 'FAQ', icon: HelpCircle },
] as const;

const CONTENT: Record<(typeof PAGES)[number]['id'], string> = {
  'getting-started': `# Getting Started

Qantara is a non-custodial checkout for QIE Mainnet. A merchant creates an invoice, shares a hosted payment link, and the payer completes the transaction with a wallet. The app tracks the invoice lifecycle as Created, Paid, Cancelled, Refunded, or Paused. Funds do not sit in an application balance; settlement is direct payer-to-merchant payment verified through QIE RPC.

Start by connecting a wallet on QIE Mainnet, then open Create invoice. Choose a token, enter the amount, add a short memo, and set an optional expiry. When the invoice is created, copy the payment link or QR code and send it to the payer. The payer opens /pay/:hash, reviews the amount and merchant, connects their wallet, and confirms the transaction.

The dashboard is for merchant operations. It lists backend invoices for the connected merchant or payer wallet and exposes quick links for receipts and explorer views. The public Explorer is read-only and requires an exact invoice hash, merchant address, or payer address.

Production payment status is updated only after the backend matches a submitted transaction hash against QIE RPC and the indexed contract or token event.`,

  'invoice-types': `# Invoice Types

Standard invoices are for a single payer and a fixed amount. Use them for freelance work, consulting, order checkout, invoices between DAOs, or one-off service fees. A Standard invoice moves from Created to Paid when the payer completes the transaction.

Donation invoices use amount 0 as an open amount. They are useful for creator tips, open-source funding, campaign pages, and small community contributions. The payer chooses the final amount on the payment page. The receipt still records the payer, merchant, token, amount, and transaction hash.

Multi-payer invoices collect many contributions toward one target. They work well for group purchases, shared bills, crowdfunding, or DAO funding rounds. Contributors pay into the invoice, the merchant watches progress, and settlement is manual. If the merchant cancels, refunds follow a pull pattern: each contributor withdraws their own refundable balance.

Recurring invoices require a deployed recurring contract or a backend scheduler that verifies each payment on-chain.

Milestone escrow and batch payouts are advanced modes. They are intentionally separate from the core checkout path because they introduce additional state, role, and refund rules.`,

  'accepting-payments': `# Accepting Payments

The simplest payment flow is a hosted Qantara link. Create an invoice, copy the /pay/:hash URL, and send it through Telegram, email, a website button, or a QR code. The payer does not need a merchant account. They only need a wallet connected to QIE Mainnet and enough gas for the payment transaction.

On the payment page, Qantara handles invoice lookup, status checks, expiry checks, and the payment transaction flow. If the invoice is expired, already paid, cancelled, or paused, the primary pay action is disabled and the page shows the current state. For QUSDC on-chain invoices, the app tries EIP-2612 permit plus payInvoiceERC20WithPermit first. If the deployed invoice contract and QUSDC token expose EIP-3009, checkout can then use transferWithAuthorization. Otherwise it falls back to approve plus payInvoiceERC20. Native QIE payments are one transaction.

After payment, the payer lands on a receipt view with the invoice hash, transaction hash, merchant, payer, token, amount, and explorer link. Merchants see the paid invoice in Dashboard and in Receipts. Receipts can be copied, exported to CSV, or downloaded as a PDF.

After payment, the backend verifies the submitted transaction hash through QIE RPC and indexed settlement events, then records the paid state, issues the receipt, dispatches invoice.paid and receipt.created webhooks, and streams the timeline through /v1/invoices/:hash/events when the client requests text/event-stream.`,

  'hosted-checkout': `# Hosted Checkout

Hosted Checkout is the API surface for Qantara. For production invoice records, create the invoice on-chain first, wait for the transaction receipt, then send the resulting chain transaction hash to the backend with a merchant-scoped API key. The backend returns a session id or invoice hash, hosted checkout URL, payment URL, expiry timestamp, and status.

Payment rails are discoverable through GET /v1/rails. The response is the product catalog for supported chains, tokens, settlement contracts, and flow readiness. Developer pages display this backend catalog directly; environment values are shown only as configuration hints when the backend catalog cannot be reached.

Create a checkout session with POST /v1/checkout/sessions after the invoice has been created on-chain. Browser merchant operations use the SIWE wallet session; merchant server integrations can use a server-side API key in the Authorization header. Lifecycle changes such as cancel, pause, or resume are wallet actions on the deployed invoice contract; after the transaction confirms, submit the tx hash to the matching /verify endpoint so the backend can mirror the indexed state. Public invoice data is available through GET /v1/invoices/:hash so the payment page can render without exposing merchant webhook secrets.

Use the Build page requirement debugger with an invoice hash to call GET /v1/payment-requirements/:hash. If that backend route is not deployed, the UI shows the backend error instead of creating a browser-side requirement. Once enabled, the response should describe chain, token, amount, merchant, state, payment URL, and verification URL for the invoice.

Use the Build page route planner with the same invoice hash to call GET /v1/payment-routes/:hash. The response describes available QIE/QUSDC route candidates, recommended wallet or contract actions, disabled reasons, explorer links, and the payment verification endpoint. It is computed by the backend from invoice state and rail availability, not by the browser.

The developer lifecycle is create -> share -> chat -> pay -> verify -> receipt -> webhook/SSE. Create and verify are backed by QIE RPC and indexed events. Share uses the returned pay_url. Chat uses /v1/invoices/:hash/messages with a merchant key or payer guest token. Receipt lookup uses /v1/receipts/:hash, while merchant receipt lists require receipts:read.

Webhook signatures use HMAC SHA-256 over timestamp.body. Every webhook includes X-Qantara-Signature, X-Qantara-Timestamp, and X-Qantara-Event-Id. Reject stale timestamps beyond five minutes and compare signatures with a constant-time function.

Webhook setup status is available through authenticated GET /v1/settings/status and delivery history through GET /v1/webhooks/deliveries. Use POST /v1/webhooks/test with the selected invoice_hash after the invoice has a configured webhook_url. Retry one delivery with POST /v1/webhooks/deliveries/:id/retry; retrying the due queue requires an operator key.

API keys must be sent with Authorization: Bearer. Do not place API keys in URLs, redirect parameters, QR codes, or EventSource query strings. Recommended merchant scopes are invoices:write for checkout creation, invoices:read for payment intent reads, receipts:read for receipt lists, webhooks:read for delivery status, webhooks:write for webhook tests and retries, and chain:read for indexed chain events.

The backend is an Express service backed by SQLite persistence. Hosted Checkout requires API_KEY, signs webhooks with WEBHOOK_SECRET, and verifies paid state through QIE RPC plus indexed settlement events.`,

  'telegram-bot': `# Telegram Bot

The Telegram bot is a merchant operations companion for existing Qantara links. Create the invoice through the wallet-backed Qantara flow, then use /link hash to bind the invoice to a Telegram chat and get a payment URL. The invoice remains a shared backend record backed by on-chain creation and RPC verification, so the web app, backend API, and Telegram bot all read the same lifecycle.

Use /status hash to poll the checkout session. Use /list to show the last five invoices linked in the current chat. Merchant lifecycle changes require the merchant wallet to submit the contract transaction first; the backend mirrors cancel, pause, resume, and refund only after tx hash verification. Inline mode can surface existing Qantara links once a chat is linked.

For payment notifications, expose the bot webhook endpoint and pass that URL as BOT_WEBHOOK_URL. The backend dispatches invoice.paid, receipt.created, and invoice_message events to the bot using the same HMAC signing scheme as merchant webhooks. The bot verifies the signature before sending a Telegram message to the linked chat.

The bot supports /reply hash message and /chat hash for deal-room communication, plus /notify_test for setup verification.`,

  'tax-receipts': `# Tax & Receipts

Receipts are built from paid invoices. The Receipts page filters by all time, last seven days, last thirty days, or a custom date range. It can sort newest first, oldest first, amount descending, or amount ascending. Search matches invoice hash, merchant address, payer address, title, and memo.

CSV export is intended for accounting and tax workflows. It includes hash, invoice type, amount, token, merchant, payer, createdAt, paidAt, transaction hash, and memo.

Per-receipt PDF download creates a compact receipt containing Qantara branding, amount, network, invoice hash, merchant, payer, timestamps, transaction hash, memo, and explorer URL.

For production, receipts should be generated from contract event data plus backend metadata. /v1/receipts/status reports whether receipts are backend-only or whether an optional on-chain receipt registry is configured. Qantara never marks a receipt anchored unless the backend has real indexed proof for that registry.

If a merchant needs immutable off-chain metadata, store a content hash on-chain and keep the underlying JSON in auditable storage. Avoid putting private customer data directly on-chain.`,

  operations: `# Operations

Qantara exposes runtime health through public /v1/health plus authenticated /v1/settings/status and /v1/metrics. The Settings page reads the same backend signals through the merchant SIWE session, so merchants see one source of truth for RPC status, indexer lag, webhook delivery depth, alert state, and payment verification failures. Chain event reads use Authorization headers and never put secrets in query strings.

Scrape /v1/metrics from external monitoring. The most important gauges are qantara_backend_up, qantara_operational_healthy, qantara_rpc_up, qantara_indexer_lag_blocks, qantara_indexer_cursor_stale_seconds, qantara_webhook_due_retries, and qantara_rpc_verification_failures_24h.

Operational alert webhooks are optional. Set ALERT_WEBHOOK_URL and ALERT_WEBHOOK_SECRET on the backend to send HMAC-signed operational.alert payloads. Use ALERT_MIN_SEVERITY to choose critical-only or warning-level delivery. Alert delivery state is persisted and visible through authenticated GET /v1/alerts/deliveries.

If the indexer lags, check authenticated /v1/chain/status, confirm QANTARA_ADDRESS, and run POST /v1/chain/sync with an operator API key. If webhook retries grow, inspect authenticated GET /v1/webhooks/deliveries and retry individual deliveries or the due queue. If RPC verification failures grow, inspect invoice timelines for payment.verification_failed and re-run verification only with the real payer and transaction hash.

Full operator details live in OPERATIONS_RUNBOOK.md in the repository. Docker Compose deployment details live in DEPLOYMENT.md.`,

  'security': `# Security

Qantara is designed as a non-custodial payment layer. The protocol should not hold a merchant balance unless a specific escrow feature requires it. Standard payment settlement should transfer funds from payer to merchant through a narrow contract call, emit a receipt event, and prevent duplicate payment.

The smart contract needs reentrancy protection, strict state transitions, amount checks, expiry checks, and token-aware payment paths. Native QIE payments validate msg.value. ERC-20 payments use SafeERC20 transferFrom and must account for allowance, decimals, and configured token allowlists. Merchant-only actions such as cancel, pause, resume, settle, and refund must check the invoice merchant, emit lifecycle events, and be mirrored by the backend only after tx receipt and indexed event verification.

Hosted Checkout server keys must be treated as server-side secrets. Do not put them in browser code or query strings. Browser merchant actions use SIWE sessions instead. Webhook verification must use timestamp freshness and timing-safe comparison. Store webhook signing secrets per merchant, rotate them on request, and keep delivery logs for failed notifications.

Telegram bot notifications must verify backend HMAC signatures before sending payment messages. Bot commands should only link, read, reply, and notify for invoices that already belong to the merchant wallet or authenticated account profile.`,

  faq: `# FAQ

## Does the payer need an account?

No. The payer opens a payment link and connects a wallet. Merchant accounts are only needed for API keys, webhooks, and dashboard history.

## What tokens are supported?

Qantara supports native QIE and QUSDC. The QUSDC address should be configured by environment until the official mainnet address is finalized.

## What happens if an invoice expires?

The payment page disables payment when expiresAt is in the past. The backend can also dispatch invoice.expired if an indexer or scheduled job marks the session expired.

## Can a merchant refund?

Refunds require a verified token-specific transfer path and should emit InvoiceRefunded from the settlement layer.

## What is next?

The next production track is deployment and incident-response runbooks for alert thresholds. External monitoring can scrape /v1/metrics, and critical alerts can be pushed through the configured alert webhook.`,
};

export function Guide() {
  const [active, setActive] = useState<(typeof PAGES)[number]['id']>('getting-started');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGES;
    return PAGES.filter(page =>
      page.title.toLowerCase().includes(q) || CONTENT[page.id].toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
      <aside className="space-y-4">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Guide</h1>
          <p className="text-text-secondary mt-1">Qantara knowledge base.</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs..."
            className="w-full h-11 pl-10 pr-4 bg-surface-1 border border-border-default rounded-full text-sm text-white placeholder:text-text-muted focus:outline-none focus:border-primary/40"
          />
        </div>

        <nav className="space-y-2">
          {filtered.map(page => (
            <button
              key={page.id}
              onClick={() => setActive(page.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-colors ${
                active === page.id
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-surface-1 border-border-default text-text-secondary hover:border-primary/30 hover:text-white'
              }`}
            >
              <page.icon className="w-4 h-4" />
              <span className="text-sm font-bold">{page.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="bg-surface-1 border border-border-default rounded-2xl p-6 md:p-10">
        <article className="prose prose-invert max-w-none
          [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-white
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8
          [&_p]:text-text-secondary [&_p]:leading-relaxed
          [&_li]:text-text-secondary
          [&_strong]:text-white
          [&_code]:text-primary [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
          [&_pre]:bg-black [&_pre]:border [&_pre]:border-border-default [&_pre]:rounded-xl [&_pre]:p-4
          [&_table]:w-full [&_th]:text-left [&_th]:text-text-muted [&_td]:text-text-secondary [&_td]:border-t [&_td]:border-border-default [&_th]:border-t [&_th]:border-border-default [&_td]:py-2 [&_th]:py-2
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{CONTENT[active]}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
