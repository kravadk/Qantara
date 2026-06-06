# Qantara Backend API

Backend API for Qantara. Express, SQLite persistence, QIE RPC verification, HMAC-signed webhooks, Telegram link persistence, receipts, payment intents, and operational health endpoints.

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Set `QANTARA_FRONTEND_URL`, `CORS_ORIGINS`, `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, and QIE RPC/contract addresses before creating production checkout sessions. Use deployed public URLs for frontend/backend values in production.

## Production Rules

- Production invoice creation requires merchant authentication and an on-chain create-invoice transaction hash.
- Paid state is never set directly by a public UI or client callback.
- Payment verification must match the real payer, merchant, token, amount, invoice hash, and transaction hash through QIE RPC and indexed settlement events.
- Public invoice reads strip merchant secrets, webhook URLs, guest tokens, and internal delivery metadata.
- Chain status, deployment status, relay status/history, onramp order reads, settings status, notifications, webhook deliveries, payment-intent lists, alert deliveries, and sync endpoints require `Authorization: Bearer <API_KEY>`.
- Stored merchant API keys can only list or mutate webhook deliveries, notifications, payment intents, receipts, chain events, and invoices for their own merchant address.
- Notification reads require `notifications:read`; read/dismiss mutations require `notifications:write`.
- Chain sync and operational alert dispatch/delivery state require the operator API key. Payment-intent list, verify, and use responses strip signature material; only create returns the signed checkout payload.
- API key list and revoke responses return only key metadata plus prefix; the secret is returned only once on creation. Revoked keys no longer authorize any protected endpoint.
- Stored key management cannot grant scopes beyond the parent key, rejects unsupported scopes, and settings status uses merchant-scoped invoice/webhook counts with redacted delivery failures.

## Endpoints

### Authenticated

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/checkout/sessions` | Create a hosted checkout session |
| `GET` | `/v1/checkout/sessions/:id` | Poll session status |
| `POST` | `/v1/invoices` | Store a production invoice after on-chain creation |
| `POST` | `/v1/invoices/:hash/verify-payment` | Verify a real payment transaction through RPC |
| `GET` | `/v1/settings/status` | Inspect operational readiness with a merchant-bounded stored key or operator key |
| `GET` | `/v1/deployments/status` | Inspect configured contract registry with an authenticated operations key |
| `GET` | `/v1/relay/status` | Inspect gas relay readiness with an authenticated operations key |
| `GET` | `/v1/relay/recent` | Inspect recent relays with an authenticated operations key |
| `GET` | `/v1/onramp/orders?wallet=0x...` | Inspect provider onramp orders for a wallet with an authenticated operations key |
| `GET` | `/v1/notifications` | List merchant notifications |
| `POST` | `/v1/notifications/:id/read` | Mark one merchant notification read |
| `POST` | `/v1/notifications/read-all` | Mark merchant notifications read |
| `POST` | `/v1/notifications/:id/dismiss` | Dismiss one merchant notification |
| `GET` | `/v1/webhooks/deliveries` | Inspect merchant-scoped webhook delivery logs |
| `POST` | `/v1/webhooks/deliveries/:id/retry` | Retry a merchant-scoped persisted webhook delivery |
| `GET` | `/v1/chain/status` | Inspect indexer/runtime chain state |
| `GET` | `/v1/chain/events` | List merchant-scoped indexed chain events |
| `POST` | `/v1/chain/sync` | Trigger an operator chain sync |
| `GET` | `/v1/payment-intents` | List merchant-scoped payment intents without signature material |
| `POST` | `/v1/payment-intents` | Create a signed payment intent |
| `GET` | `/v1/alerts/deliveries` | Inspect operational alert delivery state with the operator API key |
| `POST` | `/v1/alerts/dispatch` | Dispatch operational alerts with the operator API key |

### Public Or Invoice-Scoped

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/invoices/:hash` | Read public invoice data for the payment page |
| `GET` | `/v1/invoices?merchant=0x...` | List invoices for an exact merchant address |
| `GET` | `/v1/invoices?payer=0x...` | List invoices for an exact payer address |
| `GET` | `/v1/invoices/:hash/events` | Read or stream public invoice timeline events |
| `GET` | `/v1/payment-requirements/:hash` | Read the backend payment requirement for one invoice |
| `GET` | `/v1/payment-routes/:hash` | Read route candidates and recommended wallet/contract actions for one invoice |
| `GET` | `/v1/receipts/status` | Read backend receipt issuance and optional on-chain anchor readiness |
| `GET` | `/v1/receipts/:hash` | Read a shareable receipt |
| `GET` | `/v1/health` | Liveness and runtime health |
| `GET` | `/v1/metrics` | Prometheus metrics |
| `GET` | `/` | API summary |
| `POST` | `/v1/relay/sponsor` | Submit a signed forward request for gas sponsorship |
| `POST` | `/v1/onramp/webhook` | Receive a provider-signed onramp webhook |

## Example: create a production invoice record

Create the invoice on-chain first from the merchant wallet, then mirror the resulting hash and transaction in the backend:

```bash
curl -X POST "$BACKEND_URL/v1/invoices" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "hash": "0xINVOICE_HASH_FROM_CONTRACT",
    "chain_tx_hash": "0xCREATE_INVOICE_TRANSACTION",
    "amount": "50.00",
    "token": "QIE",
    "merchant": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "memo": "Logo design",
    "webhook_url": "https://example.com/api/webhooks/qantara",
    "expires_in": 3600
  }'
```

## Example: verify payment

The payer submits a real payment transaction hash after wallet confirmation. The backend verifies it against QIE RPC and indexed events before recording the paid state:

```bash
curl -X POST "$BACKEND_URL/v1/invoices/$INVOICE_HASH/verify-payment" \
  -H "Content-Type: application/json" \
  -d '{
    "tx_hash": "0xPAYMENT_TRANSACTION",
    "payer": "0xPAYER_ADDRESS"
  }'
```

## Webhook Signature

Each webhook POST to your `webhook_url` includes:

```text
X-Qantara-Signature: <hex_hmac_sha256>
X-Qantara-Timestamp: <unix_seconds>
X-Qantara-Event-Id:  <event_id>
```

Verification in Node.js:

```js
import crypto from 'node:crypto';

const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');

if (signature !== expected) return res.status(400).send('Bad signature');
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
  return res.status(400).send('Stale');
}
```

## Event Types

| `type` | When |
|---|---|
| `invoice.created` | On-chain invoice creation is mirrored in the backend |
| `invoice.viewed` | A payer opens the payment page |
| `message.created` | Payer or merchant posts an invoice chat message |
| `payment.detected` | A candidate payment transaction is seen |
| `invoice.paid` | On-chain settlement is confirmed |
| `receipt.created` | Receipt is issued after verified payment |
| `invoice.cancelled` | Merchant cancels before payment |
| `invoice.refunded` | Refund is confirmed through the settlement layer |
| `webhook.failed` | A webhook delivery attempt fails |

## Production Checklist

- [ ] Configure real QIE RPC, invoice contract, QUSDC, and frontend/backend public URLs.
- [ ] Use strong `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, and `SIWE_JWT_SECRET` values.
- [ ] Keep API keys server-side and pass them only in the `Authorization` header.
- [ ] Confirm `/v1/chain/status` with an API key before opening checkout traffic.
- [ ] Confirm receipts are created only after verified payment.
- [ ] Configure webhook retry monitoring and alert delivery.
- [ ] Back up the SQLite volume before deploys and migrations.

## License

MIT.
