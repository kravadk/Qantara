# Qantara — Threat Model

Scope: the hosted backend (Express + SQLite), the static frontend, the Telegram
bot, and the deployed QIE Mainnet contracts. Payment authority is on-chain; the
backend mirrors verified chain state and never originates paid state.

## Trust boundaries

```
Browser/wallet ──HTTPS──> Frontend (nginx, static)        ── public
Browser/Integrator ──HTTPS──> Backend API (Express)       ── auth: API key / SIWE session
Backend ──RPC──> QIE Mainnet (chain 1990)                 ── source of payment truth
Backend ──signed webhook──> Merchant / Telegram bot       ── HMAC-signed
Backend ──> SQLite (mirror of chain state + metadata)     ── operator-controlled
```

## Assets

- Merchant operator API keys, webhook/alert HMAC secrets, SIWE JWT secret, payment-intent secret.
- Invoice + receipt metadata and deal-room messages in SQLite.
- Funds — held and moved **only** by the contracts, never by the backend.

## Key threats and mitigations

| Threat | Mitigation |
|---|---|
| Forged "paid" state | Paid state derives only from QIE RPC receipts / indexed on-chain events; no client can assert payment. |
| API key leakage via URL/logs | Keys accepted only via `Authorization: Bearer`; hygiene guard forbids keys in query strings; reverse-proxy log redaction recommended. |
| Webhook spoofing | Outgoing webhooks HMAC-signed (`X-Qantara-Signature` + timestamp); receivers verify and enforce a freshness window. |
| Cross-merchant access | Stored API keys are merchant-scoped; scope escalation blocked; SIWE sessions are merchant-bound. |
| Brute force / DoS on public endpoints | Per-IP/per-key rate limiting on checkout, invoices, auth; 64KB body cap; non-root containers. |
| XSS / clickjacking | Frontend serves X-Frame-Options DENY, nosniff, COOP/COEP, Referrer-Policy, Permissions-Policy on every route; chat input sanitized + length-capped. |
| Chain re-org double-count | Confirmation-depth indexing (`CHAIN_CONFIRMATIONS`) + idempotent event storage (`INSERT OR IGNORE` on unique tx/logIndex). |
| Secret misconfiguration | Production startup fails fast on missing secrets; `production-preflight` validates env, CORS, chain id, contract code, and rejects non-production token metadata. |
| DB loss / corruption | Consistent `VACUUM INTO` backups + SHA-256 manifest + rehearsed restore; off-site upload wrapper. |
| Supply-chain compromise | CI dependency audit (critical), CodeQL SAST, image SBOM + cosign signing on publish. |

## Out of scope / residual risk

- **No external contract audit** — the highest residual risk for high-value
  throughput. Tracked in `SECURITY.md` and `contracts/AUDIT_CHECKLIST.md`.
- Merchant wallet/private-key compromise is the merchant's responsibility.
- RPC provider integrity — use a trusted/private `QIE_RPC_URL` for production.
- Single-instance SQLite has no built-in HA; migrate to managed SQL for horizontal scale.
- Two-phase decrypt / permit-freshness items, where applicable, per `SECURITY.md`.
