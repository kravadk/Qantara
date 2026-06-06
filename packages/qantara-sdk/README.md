# @qie/qantara-sdk

TypeScript SDK for Qantara production integrations: on-chain invoice calldata, backend invoice mirroring, rail catalog discovery, payment verification, webhooks, notifications, splits, streams, and invoice events on QIE Mainnet.

## Install

```bash
npm install @qie/qantara-sdk viem
```

## Quick Start

Production invoices are created on-chain first. After the wallet transaction is confirmed, mirror the invoice to the backend with `chainTxHash`. Merchant operations require a merchant-scoped API key unless the endpoint is explicitly public. API keys are always sent as `Authorization: Bearer <QANTARA_API_KEY>` and must never be placed in URLs or query strings.

```ts
import { randomBytes } from 'node:crypto';
import { toHex, zeroHash } from 'viem';
import { Qantara } from '@qie/qantara-sdk';

const sdk = new Qantara({
  apiKey: process.env.QANTARA_API_KEY,
  backendUrl: 'https://api.qantara.app',
  frontendUrl: 'https://qantara.app',
});

const merchant = merchantAddress;
const salt = toHex(randomBytes(32));
const createCall = sdk.invoices.buildCreateInvoiceCall({
  salt,
  amount: '0.5',
  token: 'QIE',
  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  metadataHash: zeroHash,
});

const chainTxHash = await walletClient.sendTransaction({
  account: merchant,
  to: createCall.to,
  data: createCall.data,
});
await publicClient.waitForTransactionReceipt({ hash: chainTxHash });

const invoice = await sdk.invoices.create({
  merchant,
  amount: '0.5',
  token: 'QIE',
  memo: 'Consulting invoice',
  chainTxHash,
});

console.log(invoice.hash, invoice.payUrl);
```

Share `invoice.payUrl` with the payer. The pay page is the canonical workspace for trust details, deal-room chat, wallet payment, verification status, and the issued receipt.

## Production Lifecycle

The production path is:

1. `sdk.invoices.buildCreateInvoiceCall()` builds the QIE Mainnet transaction.
2. The merchant wallet submits and confirms `createInvoice`.
3. `sdk.invoices.create()` mirrors the confirmed transaction to the backend and returns `payUrl`.
4. Merchant and payer chat through `sdk.chat.sendMessage()` and `sdk.chat.messages()`.
5. The payer pays from the hosted page or wallet flow.
6. `sdk.invoices.verifyPayment()` submits the payment transaction hash for RPC receipt verification.
7. `sdk.receipts.get()` reads the receipt issued after verified settlement.
8. `sdk.webhooks.deliveries()` and `sdk.invoices.listenInvoiceEvents()` expose webhook/SSE delivery state.

## Payments And Lifecycle

Payment and lifecycle state are mirrored by the backend only after a matching RPC-verified transaction or indexed contract event.

```ts
await sdk.invoices.verifyPayment(invoice.hash, {
  payer: payerAddress,
  txHash: paymentTxHash,
});

const cancelCall = sdk.invoices.buildCancelInvoiceCall(invoice.hash);
const cancelTxHash = await walletClient.sendTransaction({
  account: merchant,
  to: cancelCall.to,
  data: cancelCall.data,
});
await publicClient.waitForTransactionReceipt({ hash: cancelTxHash });
await sdk.invoices.verifyCancel(invoice.hash, cancelTxHash);
```

Refund discussion can be recorded before an on-chain refund is verified:

```ts
await sdk.invoices.requestRefund(invoice.hash, 'Duplicate payment');

const refundCall = sdk.invoices.buildRefundInvoiceCall(invoice.hash);
const refundTxHash = await walletClient.sendTransaction({
  account: merchant,
  to: refundCall.to,
  data: refundCall.data,
  value: refundCall.value,
});
await publicClient.waitForTransactionReceipt({ hash: refundTxHash });
await sdk.invoices.verifyContractRefund(invoice.hash, refundTxHash);
```

## Chat

Payer chat uses invoice guest tokens. Fetch requests send the token with `x-qantara-guest-token`; the SDK never puts API keys in query strings.

```ts
const payerReply = await sdk.chat.sendMessage(invoice.hash, {
  senderRole: 'payer',
  senderLabel: 'Alice',
  body: 'Can you confirm delivery timing?',
});

const merchantReply = await sdk.chat.sendMessage(invoice.hash, {
  senderRole: 'merchant',
  senderLabel: 'Merchant',
  body: 'Payment confirmation is enough to start fulfillment.',
});

const transcript = await sdk.chat.messages(invoice.hash, {
  guestToken: payerReply.guest_token,
});

await sdk.chat.markMessageRead(invoice.hash, transcript.messages[0].id, {
  guestToken: payerReply.guest_token,
});
```

## Payment Intents

Creating a payment intent returns the signature material needed by checkout.
List, verify, and use responses are redacted and do not include nonce or
signature material. Create and use require `invoices:write`; list and verify require `invoices:read`.

```ts
const signedIntent = await sdk.paymentIntents.create({
  invoiceHash: invoice.hash,
  payer: payerAddress,
});

const verified = await sdk.paymentIntents.verify(signedIntent.id);
const { intents } = await sdk.paymentIntents.list({ invoiceHash: invoice.hash });
await sdk.paymentIntents.use(signedIntent.id);
```

## Payment Requirements

`sdk.paymentRequirements.get(invoiceHash)` reads a backend-generated payment requirement for an invoice. This is the planned Qantara payment-requirement handoff object for checkout clients and paid API middleware: amount, network, token, merchant, verifier URL, expiry, and backend signature material when configured.

The SDK does not create a local requirement if the backend endpoint is unavailable. A requirement is not a receipt and does not mark the invoice paid; the backend still requires a real QIE RPC receipt or matching indexed event before settlement state changes.

```ts
const { requirement } = await sdk.paymentRequirements.get(invoice.hash, {
  payer: payerAddress,
  format: 'qantara',
});

console.log(requirement.network, requirement.token, requirement.amount);
```

## Rail Catalog

`sdk.rails.list()` reads the backend rail catalog from `GET /v1/rails`. The SDK returns backend-provided rail and payment-requirement data as-is; it does not synthesize local fallback rails if the endpoint is unavailable.

```ts
const catalog = await sdk.rails.list();
for (const rail of catalog.rails) {
  console.log(rail.id, rail.network, rail.tokenSymbol);
}
```

## Route Planner

`sdk.paymentRoutes.get(invoiceHash)` reads `GET /v1/payment-routes/:hash`. The response is built by the backend from the persisted invoice, rail catalog, RPC health, and deployment registry. It returns payable state, the recommended route id, route candidates, wallet or contract actions, explorer links, and the verification endpoint.

```ts
const plan = await sdk.paymentRoutes.get(invoice.hash);
console.log(plan.payable, plan.recommendedRouteId);

for (const route of plan.routes) {
  console.log(route.id, route.state, route.actions.map((action) => action.type));
}
```

## Explorer Activity

`sdk.explorer.activity()` is the SDK surface for a privacy-safe public activity feed when the backend exposes it. The source of truth is backend records and indexed chain events: invoices, messages, receipts, and webhook/payment events that already exist in Qantara storage.

The SDK never generates "live" rows locally and never fabricates balances, transaction hashes, paid state, or receipt history.

```ts
const feed = await sdk.explorer.activity({
  merchant,
  railId: 'qie-native',
  token: 'QIE',
  limit: 20,
});

for (const item of feed.activity) {
  console.log(item.type, item.invoiceHash, item.txHash);
}
```

## Reconciliation Status

`sdk.reconciliation.status()` reads `GET /v1/reconciliation/status`. It is an operator/source-of-truth check for backend records, RPC/indexer state, receipts, webhook delivery, and operational alerts. The SDK only returns the backend response; it does not calculate a local paid state or fill missing chain/indexer data.

Use it together with the other backend truth surfaces:

- `sdk.rails.list()` confirms which QIE/QUSDC rails, contracts, explorer links, and disabled reasons are active.
- `sdk.paymentRequirements.get(invoiceHash)` confirms the exact payment instruction for one invoice.
- `sdk.paymentRoutes.get(invoiceHash)` confirms the available payment route candidates and recommended action path.
- `sdk.explorer.activity()` confirms what real backend/indexed events are visible to users.
- `sdk.reconciliation.status()` confirms whether those records are currently consistent with RPC/indexer and delivery state.

```ts
const [rails, requirement, routes, activity, reconciliation] = await Promise.all([
  sdk.rails.list(),
  sdk.paymentRequirements.get(invoice.hash),
  sdk.paymentRoutes.get(invoice.hash),
  sdk.explorer.activity({ merchant, invoiceHash: invoice.hash, limit: 10 }),
  sdk.reconciliation.status(),
]);

console.log(rails.rails.length, requirement.requirement?.network);
console.log(routes.recommendedRouteId, activity.activity.length, reconciliation.status);
```

## Receipts

Receipts are issued only after `verifyPayment` accepts a successful QIE RPC receipt or matching indexed contract/token event.

```ts
const receiptStatus = await sdk.receipts.status();
const receipt = await sdk.receipts.get(invoice.hash);
const receiptHistory = await sdk.receipts.list({ merchant, limit: 25 });
```

`receiptStatus.verification.onChainAnchor` reports whether an optional receipt registry is configured. It never marks a receipt anchored unless the backend has real indexed proof for that registry.

## Notifications

Merchant notification APIs require a merchant-scoped API key.

```ts
const { notifications } = await sdk.notifications.list({
  merchant,
  limit: 25,
});

await sdk.notifications.markRead(notifications[0].id, merchant);
```

## Invoice Events And SSE

SSE invoice events do not carry API keys in query strings. Browser `EventSource` cannot attach custom headers, so payer-scoped event streams may include only the invoice guest token. Merchant polling through `sdk.invoices.events()` uses `Authorization` headers.

The backend replays events after the `Last-Event-ID` header. Browser `EventSource` sends that header automatically on reconnect after receiving event `id` fields. When opening a fresh stream from a saved cursor, pass `lastEventId`; the SDK sends it as the backend `after` cursor because browsers do not let callers set `Last-Event-ID` directly.

```ts
const stop = sdk.invoices.listenInvoiceEvents(invoice.hash, (event) => {
  console.log(event.type, event.payload);
}, {
  lastEventId: savedEventId,
});

stop();
```

## Operational APIs

These helpers use `Authorization: Bearer <QANTARA_API_KEY>`:

- `sdk.ops.settingsStatus()`
- `sdk.ops.metricsText()`
- `sdk.chain.events()`
- `sdk.chain.sync()` with an operator API key
- `sdk.webhooks.deliveries()`
- `sdk.webhooks.test(invoiceHash)`
- `sdk.notifications.list()`
- `sdk.paymentIntents.list()`
- `sdk.paymentIntents.verify()`
- `sdk.paymentIntents.use()`
- `sdk.rails.list()`
- `sdk.paymentRequirements.get(invoiceHash)`
- `sdk.paymentRoutes.get(invoiceHash)`
- `sdk.explorer.activity()`
- `sdk.reconciliation.status()`
- `sdk.receipts.list()`

Operational boundaries:

- `GET /v1/health`, `GET /v1/deployments/status`, `GET /v1/receipts/:hash`, and payment verification are public endpoint surfaces.
- Merchant dashboard and integration data use stored merchant API keys with merchant boundaries.
- Operator-only actions include due webhook retry, alert dispatch, and chain sync.
- API keys are accepted only through the `Authorization` header.

## Builders

The SDK uses `viem` to encode contract calls for:

- `Qantara.createInvoice`
- `Qantara.cancelInvoice`
- `Qantara.pauseInvoice`
- `Qantara.resumeInvoice`
- `Qantara.refundInvoice`
- `QantaraSplits.createSplit`
- `QantaraSubscriptionV2.createStream`
- `QantaraChat.sendMessage`

Returned objects are ready for wallet clients:

```ts
const call = sdk.chat.buildSendMessageCall(
  payerAddress,
  '0x68656c6c6f',
  zeroHash,
);
```

## Webhooks

Webhook deliveries are HMAC-signed by the backend. Delivery logs and test sends are merchant-scoped; due-queue retry is operator-only.

```ts
const ok = await sdk.webhooks.verifyWebhook({
  body: rawBody,
  timestamp: req.headers['x-qantara-timestamp'],
  signature: req.headers['x-qantara-signature'],
  secret: process.env.WEBHOOK_SECRET,
});

const test = await sdk.webhooks.test(invoice.hash);
```

## License

MIT
