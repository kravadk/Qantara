# Qantara Telegram Bot

Telegram deal-room companion for merchants that use the shared Qantara backend.

Production invoices are created from the Qantara app first, so the backend can mirror a real on-chain `createInvoice` transaction. The bot links an existing invoice to a Telegram chat, shows the pay link and chat transcript, lets the merchant reply, and receives signed backend webhooks for payment/message alerts.

The bot is a server-side integration. `QANTARA_API_KEY`, `BOT_TOKEN`,
`WEBHOOK_SECRET`, and `ALERT_WEBHOOK_SECRET` must stay in the bot runtime
environment and must never be exposed in the browser app or frontend build.

## Setup

```bash
cd tg-bot
npm install
cp .env.example .env
```

Set:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram token from BotFather |
| `QANTARA_BASE_URL` | Public frontend URL used to generate `/pay/:hash` links |
| `QANTARA_BACKEND_URL` | Backend API URL used for checkout, chat, and status calls |
| `QANTARA_API_KEY` | Operator key or merchant-scoped backend API key with `telegram:write`, `invoices:read`, and `invoices:write` |
| `BOT_WEBHOOK_PORT` | Optional HTTP port for `/webhooks/qantara` |
| `BOT_WEBHOOK_MAX_BODY_BYTES` | Maximum accepted webhook body size; default `262144` |
| `WEBHOOK_SECRET` | HMAC secret shared with backend webhook signer |
| `ALERT_WEBHOOK_SECRET` | Optional HMAC secret for backend operational alerts |
| `ALERT_CHAT_ID` | Telegram chat that receives operational alerts |

Run:

```bash
npm start
npm run dev
```

Docker profile:

```bash
QANTARA_ENV_FILE=.env.production \
docker compose --profile telegram --env-file .env.production -f ../docker-compose.production.yml up --build -d tg-bot
```

Health:

```bash
curl http://127.0.0.1:${BOT_WEBHOOK_PORT:-8081}/health
```

## Commands

| Command | Description |
|---|---|
| `/start` | Help and examples |
| `/invoice` | Explains that production invoice creation starts from the wallet app |
| `/status <hash>` | Poll backend status for an invoice linked to this Telegram chat |
| `/link <hash>` | Link an existing merchant invoice to this chat and return the payment link |
| `/cancel <hash>` | Shows verified lifecycle guidance; cancellation still starts with the merchant wallet |
| `/chat <hash>` | Show recent deal room messages for an invoice linked to this chat |
| `/reply <hash> <message>` | Reply to the payer from Telegram for an invoice linked to this chat |
| `/notify_test` | Check backend, DB, RPC, bot API key access, and webhook receiver setup |
| `/list` | Show last 5 invoices linked to this chat |

## Inline Mode

Inline mode does not create invoices. Production invoice creation requires a wallet-signed on-chain transaction, so inline queries direct the merchant back to the Qantara app.

## Payment Notifications

For backend-to-bot payment notifications:

1. Expose the bot webhook endpoint publicly.
2. Set `BOT_WEBHOOK_PORT=8080`.
3. Configure invoice webhooks in Qantara to target `${BOT_PUBLIC_URL}/webhooks/qantara`.
4. Use the same `WEBHOOK_SECRET` in `backend/.env` and `tg-bot/.env`.

When backend dispatches `invoice.paid`, `receipt.created`, or `message.created`, the bot verifies the HMAC signature and sends a Telegram notification to the chat linked to the invoice.

The bot does not mark invoices paid, issue receipts, or synthesize payment
history. It displays backend state that was created from QIE RPC verification or
indexed contract/token events.

Webhook responses are intentional:

- `200`: accepted and delivered to Telegram.
- `202`: signed event was valid but ignored because the invoice is not linked to a chat, or the event type is not one the bot sends.
- `400`: malformed JSON or missing invoice hash.
- `401`: bad or missing HMAC signature.
- `413`: request body exceeded `BOT_WEBHOOK_MAX_BODY_BYTES`.
- `502`: Telegram delivery or backend lookup failed; the backend should retry according to its delivery policy.

## Operational Alerts

The same HTTP listener can receive signed backend operational alerts:

1. Set `ALERT_CHAT_ID` to the Telegram chat that should receive backend/RPC/webhook health alerts.
2. Set `ALERT_WEBHOOK_SECRET` in `tg-bot/.env`.
3. Set backend `ALERT_WEBHOOK_URL=${BOT_PUBLIC_URL}/webhooks/alerts`.
4. Set backend `ALERT_WEBHOOK_SECRET` to the same value.

The bot accepts only signed `operational.alert` events and does not infer or create alert state in the bot process.

Operational alert responses:

- `200`: accepted and delivered to Telegram.
- `400`: malformed JSON or event type is not `operational.alert`.
- `401`: bad or missing HMAC signature.
- `503`: `ALERT_CHAT_ID` is not configured.
- `502`: Telegram delivery failed; the backend should retry according to its delivery policy.

## Auth And Scope Troubleshooting

Use `/notify_test` after deployment to confirm backend health, bot API key access to the Telegram link API, and whether the bot HTTP receiver is enabled.

- `401` from commands means `QANTARA_API_KEY` is missing, wrong, or lacks the required scope. Use the operator key or a stored merchant key with `telegram:write`, `invoices:read`, and `invoices:write`.
- `403` means the key is valid but does not match the invoice merchant. Use the merchant key for the wallet that created the invoice, or the operator key for administration.
- `404` means the invoice hash is unknown to the backend, or the invoice has not been linked to this Telegram chat. Confirm the full `0x` hash and run `/link <invoice_hash>` from the intended merchant chat.
- `bad_signature` on webhooks means the bot and backend secrets differ, the timestamp is stale, or a proxy changed the raw request body before it reached the bot.
- `telegram_delivery_failed` means the bot token, chat permissions, or target chat membership needs attention. Keep the failed backend delivery record for retry.
- Empty `/list` output is expected until `/link <invoice_hash>` succeeds in that chat.

## Architecture

```text
Qantara app
  -> wallet creates invoice on-chain
  -> backend stores/indexes invoice
  -> Telegram /link <hash>
  -> backend persists invoice-to-chat link
  -> Telegram /chat and /reply use backend chat endpoints
  -> payer pays in frontend
  -> backend verifies payment through QIE RPC/indexed events
  -> HMAC webhook to bot
  -> Telegram payment/message notification
  -> signed operational alert webhook to bot when backend health needs attention
```

The invoice-to-chat index is persisted in the shared backend through `/v1/telegram/links`, so payment and message notifications survive bot restarts. Stored merchant API keys can link only invoices for their merchant; the operator `API_KEY` can administer all links.
