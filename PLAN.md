# Qantara Plan

## Summary

Qantara is a non-custodial payment link and invoice app for QIE mainnet.
Merchants create invoices in QIE or QUSDC, share a link or QR code, and payers
complete payment from a wallet. The app verifies settlement through QIE RPC and
stores invoice metadata, receipts, chat messages, and timeline events in the
backend.

## Product Scope

### Merchant Flow

1. Connect a wallet on QIE mainnet.
2. Create an invoice with title, amount, token, memo, and optional expiry.
3. Receive a shareable `/pay/:hash` link and QR code.
4. Track invoice status in the dashboard.
5. Chat with the payer in the invoice deal room.
6. Export receipts and paid invoice history.

### Payer Flow

1. Open the payment link.
2. Review merchant address, amount, token, title, memo, and expiry.
3. Ask questions in the deal room if needed.
4. Pay from a connected wallet.
5. Backend verifies the transaction through QIE RPC.
6. Receipt shows confirmed payment state and transaction hash.

## Runtime Architecture

### Frontend

- React app for merchant dashboard, pay page, inbox, explorer, receipts, and setup pages.
- Wallet connection targets QIE mainnet.
- Payment page submits wallet transactions and sends transaction hashes to the backend for verification.
- UI state is loaded from backend API instead of client-only invoice state.

### Backend

- Express API under `/v1`.
- SQLite persistence for invoices, messages, events, guest tokens, and Telegram links.
- QIE RPC verification before marking an invoice paid.
- HMAC-signed merchant webhooks.
- SSE stream for invoice and deal room events.

### Telegram Bot

- Links existing wallet-created invoices to merchant Telegram chats.
- Reads invoice status through the authenticated backend API.
- Sends merchant replies into the invoice deal room.
- Receives backend webhook notifications for invoice events.

## Data Model

### Invoice

- `hash`
- `merchant`
- `payer`
- `token`
- `amount`
- `invoiceType`
- `status`
- `createdAt`
- `expiresAt`
- `metadataHash`
- `title`
- `memo`
- `paidAt`
- `paidTxHash`

### Message

- `id`
- `invoiceHash`
- `senderRole`
- `senderAddress`
- `senderLabel`
- `body`
- `createdAt`
- `readAt`

### Event

- `id`
- `invoiceHash`
- `type`
- `payload`
- `createdAt`

## API Surface

### Invoices

- `POST /v1/invoices`
- `GET /v1/invoices`
- `GET /v1/invoices/:hash`
- `POST /v1/invoices/:hash/verify-payment`
- `POST /v1/invoices/:hash/refund/verify`

### Deal Room

- `GET /v1/invoices/:hash/messages`
- `POST /v1/invoices/:hash/messages`
- `POST /v1/invoices/:hash/messages/:id/read`
- `GET /v1/invoices/:hash/events`

### Checkout

- `POST /v1/checkout/sessions`
- `GET /v1/checkout/sessions/:id`
- Lifecycle changes are contract transactions followed by the matching `/verify` endpoint.

## Payment Verification

### Native QIE

The backend fetches the transaction and receipt through QIE RPC and checks:

- receipt status is successful
- sender matches payer
- recipient matches merchant
- value is at least invoice amount

### QUSDC

The backend requires `QUSDC_ADDRESS`, reads token decimals from the token contract,
and verifies a matching transfer in the submitted transaction receipt. Production
preflight also checks token metadata and rejects addresses whose name or symbol
contains non-production labels.

## Security Requirements

- No client-only invoice source of truth.
- No client-authored transaction identifiers.
- No default production secrets.
- No API keys in query parameters, URLs, logs, or release artifacts.
- No seeded paid state in onboarding or product tour flows.
- Message body length limit and sanitization.
- Invoice-scoped guest tokens for payer chat access.
- Merchant browser routes use SIWE/session auth; server-to-server merchant routes use scoped API keys.
- Settings, notification, webhook delivery, and payment-intent create/list/verify/use endpoints are authenticated and merchant-scoped.
- Webhook signatures use configured secret only.
- Payment status changes only after RPC verification or indexed contract/token events.
- Product tour invoices remain unpaid until real settlement.

## Feature Phases

### Phase 1: Core Payments

- Start Hub and product onboarding.
- Create invoice.
- Pay invoice.
- Verify payment through RPC.
- Merchant dashboard.
- Receipt export.
- Hosted checkout session API.

### Phase 2: Deal Room

- Payer and merchant chat inside invoice.
- Timeline events.
- Read state.
- Telegram reply loop.
- Backend-persisted Telegram invoice links for restart-safe notifications.
- Realtime event stream.

### Phase 3: Inbox and Operations

- Payer inbox by connected wallet.
- Merchant invoice search and filters.
- Dashboard action center for open invoices, expiring links, unread events, and next best actions.
- Settings health panel for wallet, backend API, RPC, webhooks, Telegram, and display preferences.
- Notification center from backend events and RPC-verified payment state.
- Product tour invoice payment state still requires real RPC verification.
- Paid invoice exports.
- Webhook delivery records.
- Refund request workflow.

### Phase 4: On-Chain Source Of Truth And Receipts

- Chain indexer for Qantara invoice lifecycle events.
- SQLite `chain_cursor`, `chain_events`, and `invoice_sync_state` tables.
- Receipt model issued after verified payment only.
- Webhook delivery table with attempts, status, last error, and retry metadata.
- API keys with scoped permissions for merchant integrations.
- Signed payment intents with amount, token, merchant, optional payer, deadline, invoice hash, nonce, and backend signature.
- Wallet-signed production invoice creation when a merchant uses the app without an API key.
- Schema migration status exposed through backend health and settings.
- Direct-transfer refund verification for QIE and QUSDC invoices.
- Persisted webhook retry queue with manual retry and background retry worker.
- Contract transaction verification for cancel, pause, and resume before backend lifecycle state changes.
- QUSDC creation and payment flow in merchant create UI, pay page, and embedded checkout.
- Versioned SQLite migration runner with compiled migration modules and health-visible schema status.
- Contract-backed refund verification through the Qantara `InvoiceRefunded` event.
- Dashboard chain-history tab with indexed tx, block, log, contract, and payload proof.
- Paginated notification and chain-event history for larger merchant activity streams.
- EIP-2612 QUSDC permit shortcut for one-transaction contract checkout.
- EIP-3009 QUSDC transfer authorization path in the contract and checkout UI, gated by frontend config until the deployed invoice contract and QUSDC pair expose it.
- Operational monitoring for indexer lag, stale cursor age, webhook retry depth, failed webhook delivery count, and RPC payment verification failures.
- Prometheus-compatible metrics export for backend health, operational alerts, indexer lag, webhook retries, failed deliveries, and RPC verification failures.
- Optional HMAC-signed outbound alert webhooks for critical operational alerts, with persisted delivery state and cooldown.
- Runtime operations runbook covering health endpoints, alert thresholds, incident response, and release checks.
- Docker Compose deployment template for backend, static frontend, and managed SQLite volume.
- SQLite backup and restore scripts with manifest output, pre-restore snapshot, and WAL sidecar cleanup.
- CI workflow for contracts, backend, frontend, SDK, Telegram bot syntax, deployment templates, secrets scan, and source hygiene scans.
- Release packaging workflow for version tags, packaged backend/frontend/contracts/docs/SDK artifacts, checksums, and release manifest.
- Production hygiene guardrails for API-key query leakage, payment-state provenance markers, secret placeholders, SQLite backup/restore scripts, and release artifact exclusions.
- Contract deployment registry for QIE Mainnet addresses, release tags, env compatibility, and Settings/API visibility.

### Phase 5: Production Hardening

- Deploy the latest invoice contract build when EIP-3009 should be active on mainnet.
- Replace the example QUSDC address with a production token before enabling QUSDC payments in production.
- Keep test-token naming and testing assets isolated from public release bundles.

## Environment

Backend:

- `API_KEY`
- `QIE_RPC_URL`
- `QUSDC_ADDRESS`
- `WEBHOOK_SECRET`
- `PAYMENT_INTENT_SECRET`
- `SIWE_JWT_SECRET`

Frontend:

- `VITE_QANTARA_BACKEND_URL`
- merchant operations use SIWE wallet sessions in the browser; API keys stay server-side only.
- `VITE_QANTARA_ADDRESS`
- `VITE_QUSDC_ADDRESS` only after production QUSDC is configured.

Telegram bot:

- `BOT_TOKEN`
- `QANTARA_BACKEND_URL`
- `QANTARA_BASE_URL`
- `QANTARA_API_KEY`
- `DEFAULT_TOKEN`
- `WEBHOOK_SECRET`

## Verification

- Frontend typecheck, tests, and production build pass.
- Backend typecheck, tests, and production build pass.
- Telegram bot syntax check passes.
- Source scan confirms Qantara ships original code with no copied third-party implementations.
