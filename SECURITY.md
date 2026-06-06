# Security Policy

## Audit Status

Qantara contracts are not externally audited. Treat all funds as at-risk until an independent audit is published. Keep production throughput capped, use a dedicated deployer key, and transfer ownership to a multisig before meaningful value is processed.

## Current Controls

- OpenZeppelin 5.0 primitives: `ReentrancyGuard`, `Pausable`, `Ownable`, `SafeERC20`.
- Checks-effects-interactions ordering on state-changing functions.
- Pull-payment pattern for refunds and failed pushes.
- Fee-on-transfer detection for ERC-20 entry points.
- Minimum invoice amount guards.
- Owner-only emergency pause.
- Backend paid state requires QIE RPC receipt proof or indexed contract/token events.
- QUSDC routes require a configured real `QUSDC_ADDRESS`; production preflight rejects token metadata containing non-production labels.
- Webhook payloads are HMAC signed when `WEBHOOK_SECRET` is configured.
- Invoice chat uses body sanitization, length limits, rate limits, and invoice-scoped guest tokens.
- The production frontend serves `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy, Referrer-Policy, and Permissions-Policy on every route, including the SPA fallback and immutable assets.

## Runtime Trust Model

Frontend state is never the source of payment truth. A wallet transaction is submitted by the payer, then the backend checks the QIE RPC transaction and receipt:

- receipt status must be successful
- native QIE payments must come from payer, go to merchant, and include at least the invoice amount
- QUSDC payments must include a matching token `Transfer(from payer, to merchant, value >= required)`
- receipts are created only after the invoice becomes paid through verification or indexed contract events

## Production Data And Secret Boundaries

- Paid state must come only from QIE RPC receipts or indexed contract/token events. Product tour records stay open until real settlement is verified.
- API keys are accepted only through `Authorization: Bearer <key>`. Do not place API keys in URLs, query parameters, webhook payloads, telemetry, or screenshots.
- Reverse proxies, access logs, and alert receivers should redact query strings and authorization headers before storage.
- Required secrets must be generated per environment, kept out of release artifacts, and rotated after operator access changes.
- Browser merchant operations use SIWE wallet sessions. API keys are server-side credentials only and must not be embedded in frontend builds.
- SQLite database files, WAL/SHM sidecars, backup files, and pre-restore snapshots are operational data. Keep them outside source control and release bundles, encrypt backup storage, and verify the backup manifest hash before restore.

## Known Limitations

| Issue | Severity | Mitigation |
|---|---|---|
| No external audit | Critical | Cap value, publish source, complete third-party review before production volume |
| Owner key is a single EOA unless changed | High | Transfer ownership to multisig |
| No formal upgrade path | High | Deploy replacement contracts and migrate app configuration |
| No fuzz/invariant suite | High | Add Foundry or Echidna invariants before larger value |
| SQLite backend is single-instance | Operational | Migrate schema to managed SQL for horizontal scale |
| Example QUSDC address is not production-grade | High | Replace the example token before production QUSDC enablement; current metadata contains a non-production label and preflight fails it |
| Direct-transfer refund verification is incomplete | Medium | Current direct-transfer refund flow records request/approve/reject events; refunded invoice state should come from indexed contract events |

## Reporting

For vulnerabilities, open a private security report with:

- affected package or contract
- reproduction steps
- expected impact
- recommended mitigation if known

Do not publish exploit details before a fix or mitigation is available.
