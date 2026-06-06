# Qantara Contracts — Mainnet Deploy Runbook

Step-by-step operational playbook for deploying the Qantara contracts to **QIE
Mainnet (chain 1990)** and publishing a reproducible verification bundle.

> **Authorization gate.** A real mainnet deploy spends gas from a funded key and
> is irreversible. Do **not** run the `deploy:*` steps without an explicit,
> current decision to deploy, a dedicated funded deployer key, and the pre-deploy
> checklist below green. Everything up to "Deploy" is safe to run repeatedly.

## 0. Prerequisites

- Node 24, `npm ci` in `contracts/`.
- A dedicated **deployer EOA** funded with QIE for gas. Never reuse a merchant or
  relayer key. Set `PRIVATE_KEY` (or the key var read by `hardhat.config.ts`) in
  an uncommitted `.env` — never in the tree (CI `secrets-scan` enforces this).
- `QIE_RPC_URL` reachable; `QUSDC_ADDRESS` set to the **real** production token
  (production preflight rejects non-production token metadata).
- A **multisig** address ready to receive ownership after deploy.

## 1. Pre-deploy checklist (all must be green)

```bash
cd contracts
npm run build                      # hardhat compile (0.8.24, optimizer 200, paris)
npm test                           # unit + adversarial + fuzz/invariant
npm run coverage                   # solidity-coverage
RUN_CONTRACT_STATIC_ANALYSIS=true npm run audit:static   # solhint + slither (needs Python for slither)
node scripts/check-deploy-hardening.cjs                   # deploy-script hardening rules
```

Review [AUDIT_CHECKLIST.md](AUDIT_CHECKLIST.md) (threat → mitigation → test map)
and [../SECURITY.md](../SECURITY.md) known-limitations table. Confirm value caps
for initial throughput.

## 2. Deploy sequence

Each script preflights the runtime (`requireQieMainnetRuntime` enforces chain
1990) and writes addresses to `deployments/qieMainnet.json`.

```bash
npm run deploy:qie                 # Qantara + QantaraMultiPay (core)
npx hardhat run scripts/deploy-v15.ts --network qieMainnet   # MilestoneEscrow, RecurringScheduler, BatchPayout
npx hardhat run scripts/deploy-v4.ts  --network qieMainnet   # chat, splits, subscriptions, gas relay
npm run deploy:receipt-registry    # optional: QantaraReceiptRegistry
```

Copy the printed `VITE_*` / backend address block into the respective env files.

## 3. Verify (reproducible bundle + explorer)

```bash
node scripts/regen-verified.cjs                 # regenerate deployments/qieMainnet.verified.json
node scripts/regen-verified.cjs --check         # bundle inputs match source/bytecode/compiler
node scripts/check-verified-manifest.cjs        # source digest, bytecode + constructor-arg match
npm run verify                                  # hardhat verify on the QIE explorer (per contract)
```

See [VERIFY.md](VERIFY.md) for the manual bytecode-comparison procedure and the
exact compiler settings used to reproduce the build.

## 4. Post-deploy hardening (same session)

1. **Transfer ownership** of every contract to the multisig (`transferOwnership`).
2. Confirm the **pause kill-switch** works from the multisig (`pause`/`unpause`).
3. Smoke a tiny real invoice end-to-end and confirm the backend issues a receipt
   only after RPC verification.
4. Commit the updated `deployments/qieMainnet.json` + `.verified.json` (these are
   non-secret) and update the address tables in `README.md` / `VERIFY.md`.
5. Keep throughput capped until an independent audit is published.

## 5. Rollback

Contracts are **immutable** (no upgrade path by design). If a critical issue is
found pre-go-live: `pause()` from the multisig, deploy a corrected replacement,
and re-point env addresses. There is no in-place upgrade — treat the address set
as the unit of rollback.

## Out of scope

Actual mainnet execution and any third-party external audit are deliberately
**not** performed here; they require explicit authorization, a funded key, and a
separate audit engagement.
