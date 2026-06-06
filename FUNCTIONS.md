# Qantara — Function & Surface Catalog

A complete reference of every callable surface in the repo: smart-contract
functions, backend API endpoints, SDK methods, Telegram bot commands, and
frontend routes. Source of truth is the code; this is a navigation aid.

- Trust rule: paid state and receipts are **only** created after QIE RPC proof or
  indexed contract/token events. No surface marks an invoice paid on its own.
- Optional features are disabled (not broken) until their env is configured.

---

## 1. Smart contracts (QIE Mainnet, chain 1990)

Every contract is `Ownable` + `Pausable` and exposes owner-only `pause()` /
`unpause()` (omitted per-row below). Value-moving functions use `nonReentrant`
and checks-effects-interactions; refunds use the pull-payment pattern.

### Qantara — single-payer invoices (native QIE + ERC-20)
`createInvoice`, `computeInvoiceHash`, `payInvoiceNative`, `payInvoiceERC20`, `payInvoiceERC20WithPermit`, `payInvoiceERC20WithAuthorization` (EIP-3009), `cancelInvoice`, `refundInvoice`, `withdrawRefund`, `pauseInvoice`, `resumeInvoice`, `getInvoice`

### QantaraMultiPay — collective invoices
`createInvoice`, `computeInvoiceHash`, `contributeNative`, `contributeERC20`, `settleInvoice`, `cancelInvoice`, `claimRefund`, `withdrawRefund`, `getInvoice`, `getContribution`

### MilestoneEscrow — escrow with milestone tiers + optional arbiter
`createEscrow`, `computeEscrowId`, `claimMilestone`, `refundRemainder`, `getEscrow`, `previewNextMilestone`

### RecurringScheduler — prefunded recurring payments
`createSubscription`, `computeSubId`, `accruedPeriods`, `claim`, `cancel`, `withdrawPending`, `getSubscription`

### BatchPayout — multi-recipient pull payouts
`createBatch`, `computeBatchId`, `claim`, `claimWithSignature` (ECDSA bearer), `reclaim`, `getBatch`, `entitlementOf`

### QantaraSplits (v4) — split settlement
`createSplit`, `updateSplit`, `computeSplitId`, `getSplit`, `distributeNative`, `distributeERC20`, `withdrawPull`

### QantaraSubscriptionV2 (v4) — streaming subscriptions
`createStream`, `streamedSoFar`, `withdrawable`, `withdraw`, `cancel`

### QantaraChat (v4) — on-chain chat registry
`sendMessage`, `conversationIdFor`

### QantaraGasRelay (v4) — gasless EIP-712 forwarder
`verify`, `execute`, `setSelectorAllowed`, `setSelectorsBatch`
(deployed under legacy EIP-712 name `PayLinkGasRelay` — sign with that name)

### QantaraReceiptRegistry — optional on-chain receipt anchoring
`anchorReceipt`, `getReceiptAnchor`, `getInvoiceAnchor`, `isAnchored`, `setIssuer` — never determines paid state; mirrors backend-issued receipts.

### QantaraFees — fee-taking core variant (source-only, not deployed)
Same surface as `Qantara` plus `setFeeConfig`, `quoteFee`.

---

## 2. Backend API (`/v1/...`)

API keys are accepted only via `Authorization: Bearer <key>`, never in URLs.

**Core / status:** `GET /health`, `/rails`, `/rails/status`, `/settings/status`, `/deployments/status`, `/reconciliation/status`, `/metrics`, `/status`, `/qie/network-catalog`, `/qie/ecosystem`, `/qie/lending/status?address=`

**Invoices & payments:** `POST /invoices`, `GET /invoices`, `GET /invoices/:hash`, `POST /invoices/:hash/verify-payment`, `.../refund/verify`, `.../refund/verify-contract`, `.../cancel/verify`, `.../pause/verify`, `.../resume/verify`, `.../dispute/open`, `.../dispute/resolve`, `GET .../return?type=success|cancel`, `GET /payment-requirements/:hash`, `GET /payment-routes/:hash`

**Deal room:** `GET|POST /invoices/:hash/messages`, `POST .../messages/:id/read`, `GET /invoices/:hash/events` (SSE supports `Last-Event-ID`)

**Receipts / notifications / webhooks:** `GET /receipts/status`, `/receipts`, `/receipts/:hash`, `POST /receipts/:hash/anchor` (optional on-chain anchor; 412
until registry+signer configured), `GET /notifications`, `POST /notifications/:id/read`, `/read-all`, `/:id/dismiss`, `GET /webhooks/deliveries`, `POST .../:id/retry`, `/retry-due`, `/test`, `GET /webhooks/secret`, `POST /webhooks/secret/rotate`

**Chain / alerts / keys / intents:** `GET /chain/status`, `/chain/events`, `POST /chain/sync`, `GET /alerts/deliveries`, `POST /alerts/dispatch`, `GET|POST /api-keys`, `POST /api-keys/:id/revoke`, `GET|POST /payment-intents`, `POST /payment-intents/:id/verify`, `/:id/use`, `GET /auth/nonce`

**Self-serve / trust / billing / discovery:** `GET|PUT /merchants/me`, `POST /merchants/me/domain/challenge`, `/verify`, `GET /merchants/:address`, `GET /billing/summary`, `/analytics`, `/customers`, `/receipts.csv`, `GET /explorer/stats`, `/explorer/merchants`, `/explorer/activity`, `GET|PUT|DELETE /telegram/merchant`, `GET /openapi.json`

**Optional (env-gated):** `POST /relay/sponsor` (gasless, needs `RELAYER_PK`),copilot route (needs `ANTHROPIC_API_KEY`).

---

## 3. TypeScript SDK (`@qie/qantara-sdk`)

Thin client over the backend + QIE wallet calls. Construct `new Qantara(opts)`.

**Namespaced clients:** `invoices` (create/get/list/events/verifyPayment/refund +
build-call helpers), `messages`, `splits`, `streams`, `chat`, `onramp`, `rails` (list / qusdcCapabilities), `paymentRequirements.get`, `paymentRoutes.get`, `explorer` (activity / merchants), `reconciliation.status`, `receipts` (status/get/list/buildAnchorReceiptCall), `webhooks`
(deliveries/retry/test/verifyWebhook), `chain` (events/status/sync), `notifications`, `paymentIntents`, `ops`, `resolveHandle`

**High-level flows (`sdk.flows`):** `verifyPaymentChain(hash)` (7-step proof
chain), `preparePayment(hash)` (invoice + routes + requirements), `awaitPayment(hash, opts)` (poll until RPC-verified paid).

**Payment-link standard:** `buildQantaraLink`, `parseQantaraLink`, `isQantaraLink`, `qantaraLinkExpired`, `qantaraLinkToEip681`, `canonicalQantaraLinkPayload`

**Embeds / utils:** `payButtonHtml`, `embedCheckoutHtml`, `verifyWebhook`, `canonicalInvoiceCreateMessage`

---

## 4. Telegram bot (`tg-bot/`)

Commands: `/start`, `/help`, `/invoice`, `/status <hash>`, `/link <hash>`, `/chat <hash>`, `/reply <hash> <msg>`, `/notify_test`, `/cancel`, `/list`.
Plus a signed-webhook receiver with a `/health` endpoint (after `bot.launch()`).
Requires `BOT_TOKEN` + `QANTARA_API_KEY`; exits cleanly when unconfigured.

---

## 5. Frontend routes (`qie-app/`)

**Public:** `/` (Home), `/showcase`, `/manifesto`, `/status`, `/pay/:hash` (payer checkout), `/checkout/:hash`, `/profile/:address`

**Merchant workspace (`/app/*`, wallet-gated):** `start`, `dashboard`, `new-cipher` (create invoice), `advanced`, `distribute`, `developer`, `inbox`, `proofs`, `payment-proofs`, `proof`, `multipay`, `escrow`, `subscription`, `batch`, `splits`, `streams`, `checkout-api`, `webhooks`, `telegram-bot`, `explorer`, `build`, `guide`, `sdk`, `settings`, `api-keys`, `billing`, `customers`, `notifications`, `chat`, `agent`, `onramp`

Per-route metadata is set via the dependency-free `useSeo` hook; payer/invoice
pages are `noindex`.

---

## 6. Operational scripts (`scripts/`, `contracts/scripts/`)

Backend/release: `production-preflight`, `production-readiness`, `production-hygiene`, `docker-runtime-smoke`, `staging-smoke`, `monitoring-smoke`, `qie-native-smoke`, `qusdc-smoke`, `telegram-smoke`, `release-evidence`, `sqlite-backup` / `sqlite-restore`.
Contracts: `deploy`, `deploy-v15`, `deploy-v4`, `deploy-receipt-registry`, `regen-verified`, `check-verified-manifest`, `check-deploy-hardening`, `static-analysis-gated` (solhint + slither, env-gated). See
[contracts/DEPLOY_RUNBOOK.md](contracts/DEPLOY_RUNBOOK.md).
