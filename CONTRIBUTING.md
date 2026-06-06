# Contributing To Qantara

Qantara is a production payment workspace. Contributions should preserve the core trust model: invoice state comes from backend records, paid state comes from QIE RPC or indexed contract/token events, and browser code never carries server secrets.

## Setup

```bash
git clone https://github.com/your-org/qantara.git
cd qantara

cd contracts && npm install && npm test
cd ../backend && npm install && npm test
cd ../qie-app && npm install && npm test
cd ../tg-bot && npm install && node --check index.js
cd ../packages/qantara-sdk && npm install && npm run build
```

Copy each package `.env.example` to `.env` only for your own workstation. Never commit `.env`, `.env.production`, private keys, bot tokens, webhook secrets, API keys, SQLite databases, or generated backup files.

## Project Layout

```text
qie/
  contracts/                  Solidity contracts, deploy scripts, verification helpers
  backend/                    Express API, SQLite, RPC verification, webhooks, alerts
  qie-app/                    React + Vite merchant workspace and payer checkout
  tg-bot/                     Telegram command bot and signed webhook receiver
  packages/qantara-sdk/   TypeScript integration SDK
  scripts/                    Hygiene, preflight, Docker smoke, staging smoke, backup/restore
  PLAN.md                     Product scope and roadmap
  IMPLEMENTATION_PLAN.md      Current engineering phases
```

## Engineering Rules

- Payment status must not be synthesized in frontend code, docs examples, tests, product tours, or setup flows.
- QIE/QUSDC paid state must come from QIE RPC receipts, indexed contract events, or token `Transfer` logs verified by the backend.
- Browser merchant workflows use SIWE/session auth. API keys belong only in server, bot, SDK, or merchant-server contexts.
- API keys must use `Authorization: Bearer <key>` and must not appear in query strings.
- Text sent through invoice chat must keep sanitization, length limits, rate limits, and invoice-scoped access controls.
- SQLite migration changes need tests and must preserve existing data.
- Contract changes must keep CEI ordering, OpenZeppelin primitives, pull-payment patterns, and clear migration notes.

## Required Checks

Run the relevant package checks before opening a PR:

```bash
cd backend && npm run lint && npm test && npm run build
cd ../qie-app && npm run lint && npm test && npm run build
cd ../contracts && npm run build && npm test
cd ../packages/qantara-sdk && npm run lint && npm run build
cd ../../tg-bot && node --check index.js
node scripts/production-hygiene.mjs
node --check scripts/production-preflight.mjs
node --check scripts/docker-runtime-smoke.mjs
node --check scripts/staging-smoke.mjs
```

For deployment changes, also run:

```bash
QANTARA_ENV_FILE=.env.production.example \
docker compose --profile telegram --env-file .env.production.example -f docker-compose.production.yml config
```

## Pull Requests

1. Branch from `main`.
2. Keep one PR focused on one product or infrastructure change.
3. Include what changed, why it changed, and which checks were run.
4. Add tests for new behavior or changed trust boundaries.
5. Update README, deployment docs, operations docs, and security docs when runtime behavior changes.

## Good Contributions

- Merchant workspace improvements that reduce payment or setup friction.
- Better invoice chat, notifications, receipts, webhooks, and Telegram flows.
- Stronger QIE RPC/indexer verification and recovery behavior.
- Production deployment hardening, monitoring, backup/restore, and alerting.
- SDK and API docs that help a merchant integrate without exposing secrets.

## Not Accepted

- Copied competitor code.
- Frontend-only paid state, generated transaction history, or browser-stored server credentials.
- Breaking contract ABI changes without migration notes.
- New production secrets, database files, or generated artifacts committed to the repository.
- PRs that bypass source hygiene or release guardrails.

## License

By contributing, you agree your contributions are licensed under [MIT](LICENSE).
