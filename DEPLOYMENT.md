# Qantara Deployment

This guide runs Qantara as a production-style stack:

- `backend`: Express API, QIE RPC verification, SQLite persistence.
- `frontend`: static React app served by nginx.
- `tg-bot`: optional Telegram command bot and signed webhook receiver.
- `qantara_sqlite`: named Docker volume mounted at `/app/data`.

## Production Stack

1. Create the environment file:

```bash
cp .env.production.example .env.production
```

2. Set required secrets in `.env.production`:

```text
API_KEY
WEBHOOK_SECRET
PAYMENT_INTENT_SECRET
SIWE_JWT_SECRET
```

Use strong random values and do not commit `.env.production`.

Production configuration rules:

- Send API keys only with `Authorization: Bearer <key>`.
- Do not put API keys in URLs, query parameters, browser bookmarks, screenshots, or access logs.
- Keep `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, `SIWE_JWT_SECRET`, `ALERT_WEBHOOK_SECRET`, and private keys out of images and release bundles.
- Generate separate values for each environment and rotate them after operator access changes.
- Do not bake API keys into the static frontend image. Merchant browser actions use SIWE/session auth; merchant and operator API keys are server-side or integration credentials only.

3. Confirm public URLs:

```text
QANTARA_FRONTEND_URL
CORS_ORIGINS
VITE_QANTARA_BACKEND_URL
```

Set these to the real public URLs before building the frontend image. Vite embeds `VITE_*` values at build time.

Only public URLs and public contract addresses belong in `VITE_*` values. Do
not add a frontend API key variable.

4. Validate the environment before starting containers:

```bash
node scripts/production-preflight.mjs .env.production
```

The preflight blocks missing or reused core secrets, browser-exposed API-key env
names, wildcard CORS, mismatched frontend/backend contract addresses, non-HTTPS
public URLs, unreachable QIE RPC, wrong chain id, missing contract code, and
non-production QUSDC metadata.

The preflight checks required secrets, URL consistency, CORS coverage, QIE chain
id, contract code, QUSDC decimals, QUSDC metadata, and optional permit/EIP-3009
read surfaces. It fails production if token metadata contains non-production
labels.

The current example `QUSDC_ADDRESS` is useful for code-path configuration, but
RPC metadata returns a non-production token label. Replace it with the real
production QUSDC token address before enabling production QUSDC payments.

5. Build and start:

```bash
docker compose --profile telegram --env-file .env.production -f docker-compose.production.yml up --build -d
```

To validate the compose file with the checked-in template:

```bash
QANTARA_ENV_FILE=.env.production.example \
docker compose --profile telegram --env-file .env.production.example -f docker-compose.production.yml config
```

Do not publish `docker compose config` output rendered with real production
environment values, because compose expands environment variables in the output.

Before promoting a contract-aware deployment, run the deploy-hardening check
used by CI and release packaging:

```bash
cd contracts
node --check scripts/check-deploy-hardening.cjs
node --check scripts/regen-verified.cjs
node --check scripts/check-verified-manifest.cjs
node scripts/check-deploy-hardening.cjs
```

For release promotion, compile contracts first and validate the published
verification bundle as well:

```bash
npm run build
node scripts/regen-verified.cjs --check
node scripts/check-verified-manifest.cjs
```

6. Verify:

```bash
curl "$BACKEND_URL/v1/health"
curl "$BACKEND_URL/v1/metrics"
curl "$BACKEND_URL/v1/chain/status" \
  -H "Authorization: Bearer $API_KEY"
```

The frontend should be reachable at `$FRONTEND_URL`.

The frontend production image runs nginx as the `nginx` user, uses a writable
non-root PID path, and has a healthcheck against `/`. It emits the same six
security headers (`X-Frame-Options`, `X-Content-Type-Options`,
Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy, Referrer-Policy,
Permissions-Policy) on every route, including the SPA fallback and immutable
assets; because nginx does not inherit `add_header` into a location that sets its
own, these headers are repeated per location in `qie-app/nginx.conf`. If an
existing SQLite volume was created with incompatible ownership, fix the volume
permissions before starting the backend instead of running the container as root.

## SQLite Persistence

The backend stores SQLite data at:

```text
/app/data/qantara.sqlite
```

The compose file mounts this path to the named volume:

```text
qantara_sqlite
```

Do not mount the database inside the image filesystem. Keep it on a managed
volume, disk, or platform persistence layer.

## Backup And Restore

For a host-mounted backend database, create a consistent SQLite backup
with `VACUUM INTO`:

```bash
node scripts/sqlite-backup.mjs --db backend/data/qantara.sqlite --out backups
```

The script writes:

- `backups/qantara-<timestamp>.sqlite`
- `backups/qantara-<timestamp>.sqlite.json`

The JSON manifest includes source path, backup path, byte size, and SHA-256.
Record the manifest alongside the backup and verify the hash before any restore:

```bash
sha256sum -c <(printf "%s  %s\n" "$(node -p "require('./backups/qantara-YYYYMMDDTHHMMSSZ.sqlite.json').sha256")" "backups/qantara-YYYYMMDDTHHMMSSZ.sqlite")
```

Keep database files, `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, backup
directories, and pre-restore snapshots outside source control, container images,
and release artifacts.

For off-site backups, pass one remote target to the same script after installing
the matching CLI (`aws` for S3 or `gsutil` for GCS):

```bash
node scripts/sqlite-backup.mjs --db backend/data/qantara.sqlite --out backups --s3-uri s3://my-bucket/qantara
node scripts/sqlite-backup.mjs --db backend/data/qantara.sqlite --out backups --gcs-uri gs://my-bucket/qantara
```

The generated manifest records the remote target in `uploadedTo` after a
successful upload.

To restore, stop the backend first:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml stop backend
node scripts/sqlite-restore.mjs --from backups/qantara-YYYYMMDDTHHMMSSZ.sqlite --db backend/data/qantara.sqlite --yes
docker compose --env-file .env.production -f docker-compose.production.yml start backend
```

Restore creates an automatic `pre-restore-<timestamp>.sqlite` snapshot before
overwriting the target database. It also removes stale `-wal` and `-shm` sidecar
files after copying the restored database.

For the named Docker volume used by compose, run the backup script from a
short-lived Node container with the volume mounted:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml stop backend
docker run --rm \
  -v qie_qantara_sqlite:/data \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24 \
  node scripts/sqlite-backup.mjs --db /data/qantara.sqlite --out /workspace/backups
docker compose --env-file .env.production -f docker-compose.production.yml start backend
```

Run restore against the same mounted volume only after stopping the backend:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml stop backend
docker run --rm \
  -v qie_qantara_sqlite:/data \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24 \
  node scripts/sqlite-restore.mjs --from /workspace/backups/qantara-YYYYMMDDTHHMMSSZ.sqlite --db /data/qantara.sqlite --yes
docker compose --env-file .env.production -f docker-compose.production.yml start backend
```

After restore, verify:

```bash
curl "$BACKEND_URL/v1/health"
curl "$BACKEND_URL/v1/metrics"
curl "$BACKEND_URL/v1/chain/status" \
  -H "Authorization: Bearer $API_KEY"
```

Then open one known paid invoice and confirm its receipt still references the
verified QIE/QUSDC transaction hash. Do not use restore to alter invoice payment
state; payment authority remains QIE RPC receipts and indexed events.

## Health And Rollback

The backend container has a healthcheck against `/v1/health`.

Before replacing a running stack:

1. Confirm `/v1/metrics` reports `qantara_backend_up 1`.
2. Confirm `qantara_operational_healthy` is acceptable for the current environment.
3. Back up the SQLite volume.
4. Deploy the new image.
5. Confirm schema migration status through `/v1/health.migrations`.

If the new backend cannot start, roll back the image and reuse the same SQLite
volume. Migrations are tracked in `schema_migrations`.

## Alerting

To enable outbound operational alerts, set:

```text
ALERT_WEBHOOK_URL
ALERT_WEBHOOK_SECRET
```

The backend sends HMAC-signed `operational.alert` payloads and persists delivery
state in SQLite. Manual dispatch is available through:

```bash
curl -X POST "$BACKEND_URL/v1/alerts/dispatch" \
  -H "Authorization: Bearer $API_KEY"
```

Full incident handling is documented in `OPERATIONS_RUNBOOK.md`.

## Telegram Bot Receiver

Deploy the Telegram bot as a separate Node service when Telegram command and
webhook notifications are required.

Required bot values:

```text
BOT_TOKEN
QANTARA_BASE_URL
QANTARA_BACKEND_URL
QANTARA_API_KEY
```

`QANTARA_API_KEY` must be the operator key or a stored merchant key with
`telegram:write`, `invoices:read`, and `invoices:write`.

For payment and receipt notifications:

```text
BOT_WEBHOOK_PORT=8081
BOT_WEBHOOK_MAX_BODY_BYTES=262144
WEBHOOK_SECRET
```

Route the public HTTPS endpoint to:

```text
/webhooks/qantara
```

For operational alerts:

```text
ALERT_CHAT_ID
ALERT_WEBHOOK_SECRET
```

Set backend `ALERT_WEBHOOK_URL` to the bot HTTPS endpoint ending in
`/webhooks/alerts`, and use the same `ALERT_WEBHOOK_SECRET` in both services.
After deployment, run `/notify_test` in Telegram and check
`GET /v1/alerts/deliveries` after a manual `POST /v1/alerts/dispatch`.

### Compose Telegram Profile

The production compose file includes the bot behind an optional profile:

```bash
QANTARA_ENV_FILE=.env.production \
docker compose --profile telegram --env-file .env.production -f docker-compose.production.yml up --build -d tg-bot
```

The bot container exposes `/health`, `/webhooks/qantara`, and `/webhooks/alerts`
on `BOT_WEBHOOK_PORT`. Keep `QANTARA_API_KEY`, `BOT_TOKEN`, `WEBHOOK_SECRET`,
and `ALERT_WEBHOOK_SECRET` in the runtime env file only.

## Staging Smoke

Before starting containers against a real env file, run the production preflight:

```bash
node scripts/production-preflight.mjs .env.production
```

It validates required secrets, URL consistency, CORS coverage, QIE chain id, and
contract code plus metadata for `QANTARA_ADDRESS` and `QUSDC_ADDRESS`.

Expected hard blockers:

- Missing `.env.production`.
- Empty `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`, or `SIWE_JWT_SECRET`.
- `QUSDC_ADDRESS` pointing to a token whose metadata contains a non-production
  label.

When Docker is available, run the full container runtime smoke:

```bash
QANTARA_ENV_FILE=.env.production \
DOCKER_REPORT_PATH=artifacts/docker-runtime-smoke-report.json \
node scripts/docker-runtime-smoke.mjs
```

This runs compose config, image build, container start, backend health, frontend
health, Telegram bot health, Docker health status, non-root container users,
backend SQLite data-path write access, frontend `nginx -t`, and nginx runtime
write permissions for the `telegram` profile. `DOCKER_REPORT_PATH` stores a
JSON report that can be attached to the release evidence bundle.

Use the smoke harness after the backend, frontend, webhook receiver, and
Telegram bot have real staging credentials:

```bash
BACKEND_URL=https://api.example.com \
FRONTEND_URL=https://pay.example.com \
BOT_URL=https://bot.example.com \
API_KEY=$API_KEY \
STAGING_WALLET_ADDRESS=0x... \
node scripts/staging-smoke.mjs
```

After creating and paying a real invoice, extend the check with:

```bash
BACKEND_URL=https://api.example.com \
FRONTEND_URL=https://pay.example.com \
BOT_URL=https://bot.example.com \
API_KEY=$API_KEY \
STAGING_INVOICE_HASH=0x... \
STAGING_PAYER_ADDRESS=0x... \
STAGING_PAYMENT_TX_HASH=0x... \
STAGING_VERIFY_PAYMENT=true \
STAGING_TEST_WEBHOOK=true \
STAGING_DISPATCH_ALERTS=true \
STAGING_STRICT=true \
STAGING_REPORT_PATH=artifacts/staging-smoke-report.json \
node scripts/staging-smoke.mjs
```

The script does not create paid state. Payment verification runs only when a
real transaction hash is supplied with `STAGING_VERIFY_PAYMENT=true`.
`STAGING_STRICT=true` fails if frontend, Telegram, invoice, payment,
receipt, webhook, alert, and report inputs are incomplete.

For the alert receiver path, run a dedicated smoke after `ALERT_WEBHOOK_URL`
and `ALERT_WEBHOOK_SECRET` are configured. Use `MONITORING_EXPECT_DELIVERY=true`
only when an active operational alert condition has been prepared:

```bash
BACKEND_URL=https://api.example.com \
API_KEY=$API_KEY \
MONITORING_EXPECT_DELIVERY=true \
MONITORING_REPORT_PATH=artifacts/monitoring-smoke-report.json \
node scripts/monitoring-smoke.mjs
```

For native QIE, validate a real payment transaction against QIE RPC and backend
receipt issuance. `QIE_NATIVE_PAYMENT_MODE=auto` accepts either a direct
`payer -> merchant` transfer or a Qantara contract payment with a matching
`InvoicePaid` event:

```bash
BACKEND_URL=https://api.example.com \
QIE_RPC_URL=https://rpc1mainnet.qie.digital \
QANTARA_ADDRESS=0x... \
QIE_NATIVE_INVOICE_HASH=0x... \
QIE_NATIVE_PAYER_ADDRESS=0x... \
QIE_NATIVE_PAYMENT_TX_HASH=0x... \
QIE_NATIVE_EXPECT_PAYMENT=true \
QIE_NATIVE_PAYMENT_MODE=auto \
QIE_NATIVE_REPORT_PATH=artifacts/qie-native-smoke-report.json \
node scripts/qie-native-smoke.mjs
```

For QUSDC, first validate the configured token contract:

```bash
QIE_RPC_URL=https://rpc1mainnet.qie.digital \
QUSDC_ADDRESS=0x... \
node scripts/qusdc-smoke.mjs
```

After a real QUSDC invoice payment exists, validate the transfer log and backend
receipt flow:

```bash
BACKEND_URL=https://api.example.com \
QIE_RPC_URL=https://rpc1mainnet.qie.digital \
QUSDC_ADDRESS=0x... \
QUSDC_INVOICE_HASH=0x... \
QUSDC_PAYER_ADDRESS=0x... \
QUSDC_PAYMENT_TX_HASH=0x... \
QUSDC_EXPECT_PAYMENT=true \
QUSDC_REPORT_PATH=artifacts/qusdc-smoke-report.json \
node scripts/qusdc-smoke.mjs
```

For Telegram bot runtime, verify backend link persistence plus signed webhook
delivery:

```bash
BACKEND_URL=https://api.example.com \
BOT_URL=https://bot.example.com \
API_KEY=$API_KEY \
WEBHOOK_SECRET=$WEBHOOK_SECRET \
ALERT_WEBHOOK_SECRET=$ALERT_WEBHOOK_SECRET \
TELEGRAM_INVOICE_HASH=0x... \
TELEGRAM_CHAT_ID=-100... \
TELEGRAM_EXPECT_DELIVERY=true \
TELEGRAM_REPORT_PATH=artifacts/telegram-smoke-report.json \
node scripts/telegram-smoke.mjs
```

After all live smokes have written their JSON reports, build the release
evidence bundle:

```bash
READINESS_FULL=true \
READINESS_REPORT_PATH=artifacts/production-readiness-report.json \
node scripts/production-readiness.mjs

RELEASE_REQUIRED_GATES=readiness,docker,staging,monitoring,qie-native,qusdc,telegram \
READINESS_REPORT_PATH=artifacts/production-readiness-report.json \
DOCKER_REPORT_PATH=artifacts/docker-runtime-smoke-report.json \
STAGING_REPORT_PATH=artifacts/staging-smoke-report.json \
MONITORING_REPORT_PATH=artifacts/monitoring-smoke-report.json \
QIE_NATIVE_REPORT_PATH=artifacts/qie-native-smoke-report.json \
QUSDC_REPORT_PATH=artifacts/qusdc-smoke-report.json \
TELEGRAM_REPORT_PATH=artifacts/telegram-smoke-report.json \
RELEASE_EVIDENCE_PATH=artifacts/release-evidence.json \
RELEASE_EVIDENCE_MARKDOWN_PATH=artifacts/release-evidence.md \
node scripts/release-evidence.mjs
```

`RELEASE_REQUIRED_GATES` is the promotion policy. The command fails if any
required report is missing or contains failed checks, and the generated JSON
redacts secret-like fields before storing operational evidence.

## Hosted Frontend And Backend Separately

If deploying backend and frontend to separate platforms:

1. Deploy `backend/Dockerfile` with a persistent volume mounted at `/app/data`.
2. Set backend env values from `.env.production.example`.
3. Build the frontend with `VITE_QANTARA_BACKEND_URL` set to the public backend URL.
4. Set backend `CORS_ORIGINS` to the public frontend URL.
5. Set backend `QANTARA_FRONTEND_URL` to the public frontend URL.

The frontend image contains no server secrets. Merchant operator keys should stay
server-side and must not be passed as frontend build arguments.

### Vercel Static Frontend

Vercel is supported for the static frontend only. Do not deploy the Express
backend or SQLite database as Vercel serverless functions; backend state,
indexing, webhooks, Telegram, and receipts require a persistent Node service.

There are two supported project layouts:

1. Import the repository root. Vercel uses [vercel.json](vercel.json), runs `cd qie-app && npm ci`, builds with `cd qie-app && npm run build`, and serves `qie-app/dist`.
2. Import `qie-app` as the Vercel root directory. Vercel uses [qie-app/vercel.json](qie-app/vercel.json), runs `npm ci`, builds with `npm run build`, and serves `dist`.

Set only public frontend build values in Vercel:

```text
VITE_QANTARA_BACKEND_URL=https://api.qantara.app
VITE_QANTARA_ADDRESS=0x...
VITE_QANTARA_MULTIPAY_ADDRESS=0x...
VITE_QUSDC_ADDRESS=0x...
VITE_QANTARA_SUPPORTS_EIP3009=false
VITE_QUSDC_EIP3009_VERSION=1
VITE_QANTARA_CHAT_ADDRESS=0x...
VITE_QANTARA_SPLITS_ADDRESS=0x...
VITE_QANTARA_SUBSCRIPTION_V2_ADDRESS=0x...
VITE_QANTARA_GAS_RELAY_ADDRESS=0x...
```

Do not set `API_KEY`, `QANTARA_API_KEY`, `WEBHOOK_SECRET`,
`PAYMENT_INTENT_SECRET`, `SIWE_JWT_SECRET`, private keys, or any
`VITE_*_API_KEY` in Vercel. Those values belong only to backend, Telegram, or
operator environments.

Before pushing, run:

```bash
cd qie-app
npm ci
npm run lint
npm test -- --run
npm run build
```

After Vercel deploys, update the backend environment:

```text
QANTARA_FRONTEND_URL=https://qantara.app
CORS_ORIGINS=https://qantara.app
```

Then redeploy/restart the backend and verify:

```bash
curl https://api.qantara.app/v1/health
curl -I https://qantara.app
curl -I https://qantara.app/app/start
curl -I https://qantara.app/assets/<built-asset>.js
```

The Vercel configs provide SPA fallback routing, immutable cache headers for
`/assets/*`, and security headers for every route.
