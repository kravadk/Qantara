# Changelog

All notable changes to Qantara are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
semantic versioning for tagged releases.

## [1.0.0-rc.1] — Unreleased

Production-grade hardening pass toward a 1.0 public release. No deployed contract
addresses changed.

### Added
- Backend: reusable per-IP/per-key rate limiting on checkout, invoices, and auth routes.
- Backend: structured newline-delimited JSON logging with per-request correlation ids (`X-Request-Id`).
- Backend: centralized error handler (no stack-trace leakage; malformed-JSON handling).
- Backend: graceful shutdown on SIGTERM/SIGINT (drain, stop workers, WAL-checkpoint + close DB).
- Backend: fail-fast production startup validation for required secrets.
- Backend: `/v1/ready` readiness endpoint (DB + migrations + RPC) separate from `/v1/health` liveness.
- Backend: HTTP request metrics — per-route counters, latency histograms, and error counters at `/v1/metrics`.
- Backend: configurable re-org safety via `CHAIN_CONFIRMATIONS` (idempotent re-indexing).
- Backend: chain indexer cursor block-hash tracking plus bounded cursor/event rollback for canonical re-sync after a detected re-org.
- Backend: indexer safety settings and cursor anchoring are now exposed through health/status responses and Prometheus metrics.
- Backend: payment verification now accepts Qantara contract `InvoicePaid` events for on-chain QIE/QUSDC invoices, while retaining direct-transfer validation for simple invoices.
- Backend: webhook hard retry-window cap (`WEBHOOK_MAX_RETRY_WINDOW_SECONDS`).
- Frontend: app-wide error boundary, explicit 404 page, route loading fallback, startup env validation.
- Frontend: i18n key-parity guard between `en` and `uk`.
- Frontend: accessibility contract plus labels/live regions for checkout, toasts, amount inputs, and deal-room controls.
- SDK: test suite and npm publish automation (`publishConfig`, provenance).
- SDK: regression coverage for invoice mirror payloads, API-key transport boundaries, guest-token chat headers, and public payment verification.
- Contracts: randomized property/invariant ("fuzz") tests and a pre-audit checklist.
- CI/CD: CodeQL SAST, dependency audit job, dependency review, Trivy repository/image scans, SDK test gate, image publish to GHCR with SBOM + cosign signing, and a secret-gated deploy workflow.
- Ops: Prometheus scrape config + alert rules, Grafana dashboard, static status page, cross-platform off-site backup flags, and an observability guide.
- Ops: `READINESS_FULL=true node scripts/production-readiness.mjs` aggregate release gate for backend, frontend, SDK, contracts, Telegram syntax, and compose validation.
- Ops: production preflight now checks public URL scheme, wildcard CORS, frontend/backend contract-address parity, browser-exposed API-key env names, bot env dependencies, RPC timeout, and core secret reuse.
- Ops: Docker runtime smoke now validates container health, non-root users, backend data-path write access, frontend `nginx -t`, and nginx runtime write permissions.
- Ops: staging smoke now has `STAGING_STRICT=true` for full live-flow validation with receipt/timeline/webhook/alert checks and optional JSON report output.
- Ops: added `scripts/monitoring-smoke.mjs` for live alert receiver, dispatch, delivery-log, and metrics validation with optional JSON report output.
- Ops: added `scripts/qie-native-smoke.mjs` for live native QIE payment receipt/log, backend verification, receipt, and timeline validation.
- Ops: added `scripts/qusdc-smoke.mjs` for live QUSDC token metadata, capability, transfer-log, backend verification, receipt, and timeline validation.
- Ops: added `scripts/telegram-smoke.mjs` for live Telegram bot health, backend link persistence, signed payment webhook, and signed alert webhook validation.
- Ops: added release evidence aggregation with redacted JSON/Markdown output across readiness, Docker, staging, monitoring, QUSDC, and Telegram smoke reports.
- IaC: Terraform scaffolding for Railway + Vercel + DNS plus CI format/validate gate (deploy-ready, not applied).
- Docs: `SUPPORT.md`, `THREAT_MODEL.md`, `contracts/AUDIT_CHECKLIST.md`, `CHANGELOG.md`, `qie-app/ACCESSIBILITY.md`.

### Fixed
- Frontend: nginx security headers were silently dropped on served routes due to
  `add_header` inheritance; now emitted on every route.
- Docs: corrected the Telegram bot webhook port in `DEPLOYMENT.md` (8081).

### Notes
- Going live still requires operator-supplied inputs: a real production `QUSDC_ADDRESS`,
  `BOT_TOKEN`, a domain + hosting, and deploy/publish secrets.
- No external third-party contract audit has been completed (see `SECURITY.md`).

## [0.1.0] — Initial

- Invoice create/pay/lifecycle on QIE Mainnet (chain 1990), hosted checkout,
  deal-room chat, receipts, HMAC webhooks, chain indexer, operational alerts,
  Telegram bot, and the TypeScript SDK.
