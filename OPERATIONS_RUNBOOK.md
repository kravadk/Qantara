# Qantara Operations Runbook

This runbook covers production runtime checks for the backend, chain indexer,
webhook delivery queue, RPC payment verification, and operational alerts.

## Required Endpoints

Use these endpoints from the deployed backend:

- `GET /v1/health`: JSON health, schema migration status, RPC status, indexer state, operational alerts.
- `GET /v1/settings/status`: API-key protected readiness across backend, RPC, contracts, webhooks, Telegram, security, and alerts. Stored merchant keys receive merchant-scoped counts and delivery state.
- `GET /v1/reconciliation/status`: operator source-of-truth check across backend records, RPC/indexer state, receipts, webhook delivery, and active alerts.
- `GET /v1/metrics`: Prometheus-compatible operational gauges.
- `POST /v1/alerts/dispatch`: manually dispatch active operational alerts to `ALERT_WEBHOOK_URL`.
- `GET /v1/alerts/deliveries`: inspect persisted alert webhook delivery state.

Merchant actions and payment status must still come from backend records plus
QIE RPC or indexed contract events. Do not mark invoices paid manually.

## Runtime Configuration

Backend:

- `API_KEY`: merchant and operator API key.
- `QIE_RPC_URL`: QIE RPC endpoint. Defaults to public QIE mainnet RPC when unset.
- `QANTARA_ADDRESS`: deployed invoice contract for indexing and contract lifecycle verification.
- `QUSDC_ADDRESS`: configured production QUSDC token used for token invoice verification. The deployment preflight rejects token metadata containing non-production labels.
- `WEBHOOK_SECRET`: HMAC secret for merchant webhooks.
- `PAYMENT_INTENT_SECRET`: HMAC secret for backend-signed payment intents.

Operational thresholds:

- `INDEXER_MAX_LAG_BLOCKS`: default `50`.
- `INDEXER_STALE_AFTER_SECONDS`: default `120`.
- `WEBHOOK_MAX_DUE_RETRIES`: default `0`.
- `RPC_VERIFY_MAX_FAILURES_24H`: default `0`.

Optional alert webhook:

- `ALERT_WEBHOOK_URL`: HTTPS receiver for operational alerts.
- `ALERT_WEBHOOK_SECRET`: HMAC secret for alert payloads.
- `ALERT_MIN_SEVERITY`: `critical` by default; set `warning` to receive all active alerts.
- `ALERT_COOLDOWN_SECONDS`: default `300`.
- `ALERT_INTERVAL_MS`: default `60000`.

## Metrics To Scrape

Scrape `GET /v1/metrics` and alert on these gauges:

- `qantara_backend_up`: must be `1`.
- `qantara_operational_healthy`: should be `1`.
- `qantara_rpc_up`: must be `1`.
- `qantara_rpc_block_number`: should advance over time.
- `qantara_indexer_healthy`: should be `1` when `QANTARA_ADDRESS` is configured.
- `qantara_indexer_lag_blocks`: alert above `INDEXER_MAX_LAG_BLOCKS`.
- `qantara_indexer_cursor_stale_seconds`: alert above `INDEXER_STALE_AFTER_SECONDS`.
- `qantara_indexer_cursor_anchored`: should become `1` after the indexer writes a cursor with block-hash metadata.
- `qantara_indexer_confirmations` and `qantara_indexer_reorg_rollback_blocks`: confirm the runtime safety settings match the intended deployment.
- `qantara_webhook_due_retries`: alert above `WEBHOOK_MAX_DUE_RETRIES`.
- `qantara_webhook_failed_deliveries`: investigate when increasing.
- `qantara_rpc_verification_failures_24h`: alert above `RPC_VERIFY_MAX_FAILURES_24H`.
- `qantara_operational_alerts`: count of active alert conditions.
- `qantara_operational_alert_active{id,severity}`: active alert labels.

## Operational Readiness Checks

Run this checklist before a release, restore, key rotation, or public merchant onboarding:

0. Run `READINESS_FULL=true READINESS_REPORT_PATH=artifacts/production-readiness-report.json node scripts/production-readiness.mjs` and review the scorecard.
1. Confirm `GET /v1/health` reports database health, migration status, and RPC reachability.
2. Confirm `GET /v1/settings/status` with the intended operator key reports contracts, webhooks, Telegram, alerts, and security readiness.
3. Confirm `GET /v1/reconciliation/status` reports consistent backend records, RPC/indexer state, receipts, webhook delivery, and active alert state.
4. Confirm `GET /v1/metrics` includes `qantara_backend_up 1`, `qantara_rpc_up 1`, and acceptable operational alert counts.
5. Confirm `QANTARA_ADDRESS` and `QUSDC_ADDRESS` match the intended QIE Mainnet deployment registry, and confirm `node scripts/production-preflight.mjs .env.production` accepts QUSDC metadata.
6. Confirm `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, `SIWE_JWT_SECRET`, and alert secrets are unique generated values and are not present in release artifacts.
7. Confirm API clients send keys only with `Authorization: Bearer <key>`, proxy logs redact authorization headers and query strings, and frontend images do not contain API keys.
8. Confirm product tour flows do not create paid state without a verified QIE/QUSDC settlement transaction.
9. Create a SQLite backup, verify the manifest byte count and SHA-256, and confirm the backup file is stored outside the release package.
10. For production, confirm an off-site target is configured with `--s3-uri` or `--gcs-uri`, and confirm the backup manifest includes `uploadedTo`.
11. Host `ops/status-page.html` or configure a third-party monitor against `/v1/ready`.
12. Rehearse restore into a separate throwaway database path with the backend stopped, then run health and metrics checks against the restored copy.
13. Dispatch a signed operational alert and confirm persisted delivery state before relying on alerting for production incidents.
14. Run `node scripts/monitoring-smoke.mjs` with `MONITORING_EXPECT_DELIVERY=true` during an alert receiver drill and archive the JSON report from `MONITORING_REPORT_PATH`.
15. Run `node scripts/qie-native-smoke.mjs` with `QIE_NATIVE_EXPECT_PAYMENT=true` after a real native QIE payment to archive direct-transfer or contract `InvoicePaid` evidence, backend receipt readback, and timeline evidence.
16. Run `node scripts/qusdc-smoke.mjs` for QUSDC metadata/capability validation, then rerun with `QUSDC_EXPECT_PAYMENT=true` after a real token payment to archive transfer, receipt, and timeline evidence.
17. Run `node scripts/telegram-smoke.mjs` with `TELEGRAM_EXPECT_DELIVERY=true` after bot deployment to verify bot health, backend invoice-chat link persistence, signed payment webhooks, signed alert webhooks, and Telegram delivery.
18. Run `node scripts/release-evidence.mjs` with `RELEASE_REQUIRED_GATES=readiness,docker,staging,monitoring,qie-native,qusdc,telegram` to produce one redacted release-evidence bundle from the archived JSON reports.

## Source-Of-Truth Drill

Use the SDK or direct HTTP requests to compare the operational surfaces before diagnosing user-visible payment state:

1. `GET /v1/rails` confirms which QIE/QUSDC rails, deployed contracts, explorer links, and disabled reasons are active.
2. `GET /v1/payment-requirements/:hash` confirms the exact network, token, amount, merchant, expiry, and verifier for one invoice.
3. `GET /v1/explorer/activity` confirms the visible activity feed is backed by persisted backend records and indexed chain events.
4. `GET /v1/reconciliation/status` confirms whether backend records, RPC/indexer state, receipts, webhook delivery, and alerts agree.

If these surfaces disagree, treat the backend/RPC/indexer mismatch as an operational incident. Do not repair it by editing invoice paid state, adding client-only UI rows, or creating placeholder receipt data.

## Incident: RPC Down

Symptoms:

- `qantara_rpc_up = 0`
- `/v1/health.rpc.ok = false`
- Pay page verification fails after the wallet transaction is sent

Actions:

1. Check `QIE_RPC_URL` reachability from the backend host.
2. Compare against the public QIE mainnet RPC in a separate terminal.
3. Switch `QIE_RPC_URL` to a healthy endpoint if the configured provider is down.
4. Restart the backend.
5. Re-run pending payment verification from the UI or API after RPC recovers.

Do not mark an invoice paid without a successful QIE RPC receipt or indexed
contract event.

## Incident: Indexer Lag

Symptoms:

- `indexer.lag_high`
- `indexer.cursor_stale`
- `qantara_indexer_lag_blocks` keeps increasing

Actions:

1. Confirm `QANTARA_ADDRESS` is set to the deployed contract address.
2. Check `/v1/chain/status` for cursor block, runtime state, and last error.
3. Run `POST /v1/chain/sync` with an operator API key.
4. If the lag is large, sync in bounded ranges using `from_block` and `to_block`.
5. Confirm `qantara_indexer_lag_blocks` returns below threshold.

Invoices may still be verified by direct transaction hash while the indexer is
catching up, but dashboard chain history and contract lifecycle mirroring will
lag until the cursor catches up.

## Incident: Webhook Retry Queue

Symptoms:

- `webhooks.retry_depth_high`
- `qantara_webhook_due_retries > 0`
- Settings shows failed deliveries

Actions:

1. Inspect `GET /v1/webhooks/deliveries`.
2. Check the merchant receiver URL and last HTTP status.
3. Fix receiver availability or signature verification on the merchant side.
4. Use `POST /v1/webhooks/deliveries/:id/retry` for a single delivery.
5. Use `POST /v1/webhooks/retry-due` for the due queue.

Delivery failures should not block invoice creation, chat, payment verification,
or receipt issuance.

## Incident: RPC Verification Failures

Symptoms:

- `rpc.verification_failures_high`
- `qantara_rpc_verification_failures_24h` exceeds threshold
- Invoice timeline contains `payment.verification_failed`

Actions:

1. Open the invoice timeline and inspect the failure reason.
2. Confirm the submitted `tx_hash` exists on the QIE explorer.
3. For native QIE, verify sender, recipient, value, and receipt status.
4. For QUSDC, verify token address, token metadata, decimals, and matching `Transfer` event.
5. Use `scripts/qusdc-smoke.mjs` with `QUSDC_PAYMENT_TX_HASH`, `QUSDC_PAYER_ADDRESS`, and the invoice hash to confirm the backend agrees with the RPC receipt.
5. Ask the payer to submit the correct transaction hash if the wrong hash was used.

Do not edit the paid status directly. Re-run `/v1/invoices/:hash/verify-payment`
with the correct payer address and transaction hash.

## Alert Webhook Verification

Alert payloads use the same signing model as merchant webhooks:

- `X-Qantara-Signature`
- `X-Qantara-Timestamp`
- `X-Qantara-Event-Type: operational.alert`

Verify with:

```text
hex(hmac_sha256(ALERT_WEBHOOK_SECRET, `${timestamp}.${rawBody}`))
```

Reject stale timestamps and compare signatures with a constant-time comparison.

## Telegram Bot Operations

The Telegram bot is an operations surface over the shared backend. It must not
invent invoice, payment, chat, or alert state.

Required bot access:

- `QANTARA_API_KEY` must be the operator key or a stored merchant key with
  `telegram:write`, `invoices:read`, and `invoices:write`.
- A stored merchant key can link and manage only invoices whose merchant address
  matches that key.
- `WEBHOOK_SECRET` must match the backend invoice webhook signer.
- `ALERT_WEBHOOK_SECRET` must match backend `ALERT_WEBHOOK_SECRET` when alert
  delivery is enabled.

Operator checks:

1. Run `/notify_test` in Telegram and confirm backend, DB, RPC, bot API key
   access, payment webhook, and alert receiver state.
2. Run `GET /v1/settings/status` with the same key class expected for the bot.
3. Confirm `GET /v1/metrics` reports backend, RPC, webhook queue, and alert
   gauges.

Troubleshooting:

- Command `401`: rotate or replace `QANTARA_API_KEY`; confirm the stored key
  includes all required scopes.
- Command `403`: the key is valid but outside the invoice merchant boundary.
  Use the invoice merchant key or the operator key.
- Command `404`: confirm the full invoice hash, then link the invoice from the
  intended Telegram chat with `/link <invoice_hash>`.
- Webhook `bad_signature`: compare backend and bot secrets, clock skew, and any
  proxy behavior that rewrites the raw request body.
- Webhook `payload_too_large`: increase `BOT_WEBHOOK_MAX_BODY_BYTES` only after
  confirming the backend payload is expected.
- Webhook `telegram_delivery_failed` or `alert_delivery_failed`: verify bot chat
  membership, Telegram token validity, and retry the persisted backend delivery.
- A `202` payment webhook response is not a failure. It means the signed event
  was valid but the invoice is not linked to a Telegram chat, or the event type
  does not require a Telegram message.

## Release Checklist

Before promoting a backend deployment:

1. Run `cd backend && npm run lint && npm test && npm run build`.
2. Run `cd qie-app && npm run lint && npm test && npm run build`.
3. Run `cd packages/qantara-sdk && npm run lint && npm run build`.
4. Run `cd tg-bot && node --check index.js`.
5. Confirm `/v1/health` returns `db: "ok"`.
6. Confirm `/v1/metrics` returns `qantara_backend_up 1`.
7. Confirm `QANTARA_ADDRESS` and `QUSDC_ADDRESS` match the intended network and pass production preflight metadata checks.
8. Confirm `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, and alert secrets are unique generated values.
9. Create a SQLite backup with `node scripts/sqlite-backup.mjs --db <path> --out backups`.
10. Confirm the backup manifest has a SHA-256, non-zero byte size, and `uploadedTo` when a remote target was configured.
11. Confirm `ops/status-page.html?api=<backend-url>` reports `/v1/health` and `/v1/ready` from the intended backend.
12. Confirm API keys do not appear in URLs, access logs, frontend build artifacts, release manifests, or support attachments.
