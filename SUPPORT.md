# Support

## Getting help

- **Bugs / feature requests:** open a GitHub issue with steps to reproduce, the
  `X-Request-Id` response header (if from the API), and the environment (network,
  contract addresses, browser/wallet).
- **Security issues:** do **not** open a public issue. See `SECURITY.md` for
  responsible-disclosure instructions.
- **Operations / deployment:** see `DEPLOYMENT.md` and `OPERATIONS_RUNBOOK.md`.
- **SDK usage:** see `packages/qantara-sdk/README.md`.

## Before filing an issue

- Check `GET /v1/health` and `GET /v1/ready` on your backend.
- Confirm `node scripts/production-preflight.mjs .env.production` passes.
- Run `node scripts/production-readiness.mjs` for an aggregated scorecard.

## Service expectations

Qantara is open-source software provided as-is. There is no paid SLA. The
contracts are deployed to QIE Mainnet (chain 1990) but have **not** had an
external third-party audit — review `SECURITY.md` before moving significant value.
