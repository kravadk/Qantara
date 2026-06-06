# Qantara Implementation Plan

## Current Runtime Architecture

Qantara now uses real runtime data paths:

- Frontend reads invoices through the backend API.
- Backend persists invoices, messages, events, guest access tokens, and Telegram links in SQLite.
- Payment confirmation is verified through QIE RPC before an invoice is marked paid.
- Telegram commands call the backend API instead of keeping their own invoice state.
- Deal room messages and invoice timeline events are backend records and are streamed to the UI.

## Runtime Data Contract

### Backend API

- `POST /v1/invoices` creates a wallet app invoice. Production records require a merchant SIWE session, server API key, or wallet signature over the canonical invoice payload; paid state requires real settlement.
- `GET /v1/invoices` lists invoices with merchant, payer, and status filters.
- `GET /v1/invoices/:hash` returns one invoice.
- `POST /v1/invoices/:hash/verify-payment` verifies a submitted transaction through QIE RPC and settles the invoice record.
- `POST /v1/invoices/:hash/refund/verify` verifies a real QIE/QUSDC refund transaction and moves a paid invoice to refunded.
- `POST /v1/invoices/:hash/refund/verify-contract` verifies a Qantara `InvoiceRefunded` event before mirroring contract-backed refunds.
- `POST /v1/invoices/:hash/cancel/verify`, `/pause/verify`, and `/resume/verify` verify the matching Qantara contract event before mirroring lifecycle state.
- `GET /v1/health` reports backend, SQLite, and RPC configuration health.
- `GET /v1/health` is public liveness; `GET /v1/settings/status` is API-key protected operational monitoring for indexer lag, stale cursor age, webhook retry depth, failed delivery count, and RPC verification failures.
- `GET /v1/metrics` exports Prometheus-compatible gauges for the same operational signals.
- `POST /v1/alerts/dispatch` sends optional HMAC-signed operational alert webhooks when `ALERT_WEBHOOK_URL` and `ALERT_WEBHOOK_SECRET` are configured.
- `OPERATIONS_RUNBOOK.md` documents health checks, metrics, alert thresholds, incident response, and release verification.
- `docker-compose.production.yml`, `.env.production.example`, and frontend/backend Dockerfiles provide a production-style backend, frontend, and SQLite volume deployment template.
- `scripts/sqlite-backup.mjs` and `scripts/sqlite-restore.mjs` provide guarded SQLite backup/restore workflow with manifests and pre-restore snapshots.
- `.github/workflows/ci.yml` runs contracts, backend, frontend, SDK, Telegram bot syntax, deployment template validation, secrets scan, and source hygiene scan on push and pull request.
- `.github/workflows/release.yml` packages tagged releases with backend, frontend, contracts, docs, SDK tarball, SHA-256 checksums, and a release manifest.
- `scripts/production-hygiene.mjs` checks operator docs, workflows, runtime source, SQLite scripts, API-key query leakage, secret placeholders, and release artifact exclusions.
- `GET /v1/deployments/status` exposes the QIE Mainnet contract registry with release tags, verified addresses, env compatibility, and Settings/API visibility.
- `POST /v1/telegram/links`, `GET /v1/telegram/links`, and `GET /v1/telegram/links/:hash` persist Telegram invoice-to-chat routing in SQLite.
- `GET /v1/invoices/:hash/messages` returns deal room messages.
- `POST /v1/invoices/:hash/messages` creates a payer, merchant, or system message.
- `POST /v1/invoices/:hash/messages/:id/read` marks a message read.
- `GET /v1/invoices/:hash/events` streams invoice and message events.
- `GET /v1/receipts/:hash` returns the receipt issued after verified payment.
- `GET /v1/webhooks/deliveries` returns merchant-scoped persisted webhook delivery attempts.
- `POST /v1/webhooks/deliveries/:id/retry` manually retries a merchant-scoped persisted webhook delivery.
- `POST /v1/webhooks/retry-due` retries due webhook deliveries from the persisted queue and requires the operator API key.
- `POST /v1/webhooks/test` sends a real signed test delivery for an invoice webhook within the authenticated merchant boundary.
- `GET /v1/chain/status` reports RPC/indexer status.
- `POST /v1/chain/sync` indexes Qantara contract lifecycle events.
- `GET /v1/settings/status` returns API-key protected operational readiness across backend, RPC, contracts, webhooks, Telegram, and security.
- `GET /v1/notifications`, `/read-all`, `/:id/read`, and `/:id/dismiss` persist merchant notification state behind API-key authentication.
- `GET /v1/payment-intents` lists redacted payment-intent records within the authenticated merchant boundary.
- `POST /v1/payment-intents` creates signed payment intents for existing open invoices within the authenticated merchant boundary.
- `POST /v1/payment-intents/:id/verify` verifies backend intent signatures and expiry within the authenticated merchant boundary.
- `POST /v1/payment-intents/:id/use` marks a payment intent as used within the authenticated merchant boundary without exposing signature material.

### Persistence

SQLite is the source of application data for the current build:

- `invoices`
- `messages`
- `events`
- `telegram_links`
- `guest_tokens`
- `receipts`
- `webhook_deliveries`
- `chain_cursor`
- `chain_events`
- `invoice_sync_state`
- `api_keys`
- `payment_intents`
- `schema_migrations`

The backend is responsible for sanitizing user text, limiting message length, and enforcing invoice-scoped guest access.

### Chain Verification

Native QIE payments are verified by fetching the transaction and receipt through QIE RPC:

- receipt status must be successful
- transaction sender must match the connected payer
- transaction recipient must match the invoice merchant
- transaction value must be at least the invoice amount

QUSDC payments require `QUSDC_ADDRESS`. The backend reads token decimals from the token contract and verifies a matching `Transfer` event in the submitted transaction receipt. Production preflight rejects QUSDC token metadata containing non-production labels; the current example address returns one of those labels and must be replaced before production QUSDC enablement.

## Frontend Scope

### Pay Page

- Load invoice details from `GET /v1/invoices/:hash`.
- Submit native QIE payment with `wagmi`.
- Send transaction hash to `POST /v1/invoices/:hash/verify-payment`.
- Show confirmed status only after backend RPC verification.
- Show trust rail, wallet health, and next-step payment timeline.
- Render deal room chat below payment controls.

### Start Hub

- `/app/start` is the default authenticated entrypoint.
- Shows quick actions, setup checklist, wallet/backend health, notification summary, and recent invoice actions.
- Product tour transaction, balance, and paid state require verified settlement.

### Merchant Dashboard

- Load merchant invoices from `GET /v1/invoices?merchant=<address>`.
- Show backend/RPC status in the drawer.
- Show a needs-attention action center for open invoices, expiring invoices, unread events, and next actions.
- Use deal room tabs for details, chat, timeline, and receipt.
- Keep unsupported contract actions disabled until the matching contract method or authenticated merchant endpoint exists.

### Settings and Notifications

- Settings displays wallet/network health, backend `/v1/health`, webhook status, Telegram commands, and UI preferences.
- Notifications derive events from backend invoice records, deal room events, webhook delivery records, and RPC-verified paid state.

### Inbox

- Load payer invoices from `GET /v1/invoices?payer=<address>`.
- Keep invoice actions tied to backend state.

### Explorer and Receipts

- Explorer lists backend invoices.
- Receipts are generated from paid backend invoices.
- CSV/export data comes from backend invoice records.

## Telegram Bot Scope

- `/link <hash>` binds an existing wallet-created invoice to the current Telegram chat.
- `/status <hash>` reads status through the backend API.
- `/reply <hash> <message>` posts merchant messages into the deal room.
- `/chat <hash>` displays recent backend messages.
- Invoice-to-chat routing is persisted through the backend Telegram link API instead of process memory.
- Webhook notifications are signed only when `WEBHOOK_SECRET` is configured.

## Environment Requirements

Backend:

- `API_KEY` for server-side operator and merchant integration routes.
- `QIE_RPC_URL` optional; default is the public QIE mainnet RPC.
- `QUSDC_ADDRESS` required for QUSDC verification.
- `WEBHOOK_SECRET` required when webhook delivery is enabled.
- `PAYMENT_INTENT_SECRET` and `SIWE_JWT_SECRET` required for production signed intents and wallet sessions.

Frontend:

- `VITE_QANTARA_BACKEND_URL` points to the backend API.
- Merchant operational reads use SIWE wallet sessions in the browser. API keys stay in backend, bot, SDK, or merchant server integrations.
- `VITE_QANTARA_SUPPORTS_EIP3009=true` enables the QUSDC `transferWithAuthorization` checkout path only after the deployed invoice contract supports it.
- `VITE_QUSDC_EIP3009_VERSION` sets the token's EIP-712 domain version for EIP-3009 signatures; default is `1`.

Telegram bot:

- `QANTARA_BACKEND_URL`
- `QANTARA_BASE_URL`
- `QANTARA_API_KEY`
- `BOT_TOKEN`
- `DEFAULT_TOKEN`
- `WEBHOOK_SECRET` when webhook receiver is enabled.

## Remaining Production Work

1. Redeploy the invoice contract if mainnet checkout should use the new EIP-3009 method.
2. Replace the example QUSDC address with a production token address that passes metadata preflight.
3. Replace legacy contract docs and test-token naming with production-safe language while keeping testing assets out of public release bundles.

## Verification Checklist

- `qie-app`: typecheck, tests, and production build pass.
- `backend`: typecheck, tests, and production build pass.
- `tg-bot`: syntax check passes.
- Source scan has no legacy client-side invoice store, client-authored transaction identifiers, example secrets, or seeded payment state in runtime code.
- Release scan excludes runtime environment files, SQLite databases, backup snapshots, dependency directories, caches, coverage output, and generated contract artifacts.
