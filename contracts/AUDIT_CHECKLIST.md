# Qantara Contracts — Pre-Audit Checklist

A reviewer-facing checklist to run before commissioning an external third-party
audit of the deployed QIE Mainnet (chain 1990) contracts. The deployed addresses
are recorded in `deployments/qieMainnet.json` and the reproducible source/bytecode
bundle in `deployments/qieMainnet.verified.json`.

## Scope

Core payment path (highest value, audit first):

- `Qantara` — invoice create / pay (native + ERC-20) / cancel / pause / resume / refund.
- `QantaraMultiPay` — collective payments.
- `QantaraReceiptRegistry` — optional receipt hash anchoring after backend RPC/indexer verified payment.
- `MilestoneEscrow`, `RecurringScheduler`, `BatchPayout` — V1.5 value-moving contracts.
- V4: chat, splits, subscriptions, gas relay (`deployments/qieMainnet.json`).

## Invariants covered by automated tests

| Invariant | Test |
|---|---|
| Invoice hash determinism + collision-freedom | `test/Invariants.fuzz.test.ts` |
| Exact-amount enforcement (underpay reverts `AmountMismatch`) | `test/Invariants.fuzz.test.ts`, `test/Qantara.test.ts` |
| No double-pay (second pay reverts `WrongStatus`) | `test/Invariants.fuzz.test.ts`, `test/Qantara.test.ts` |
| Refund accounting conservation (credited == paid, fully withdrawable, zeroed after) | `test/Invariants.fuzz.test.ts` |
| Donation minimum enforcement | `test/Invariants.fuzz.test.ts`, `test/Qantara.test.ts` |
| Duplicate-salt create reverts `InvoiceExists` | `test/Qantara.test.ts` |
| Receipt anchors are issuer-gated and one-time per invoice / receipt hash | `test/QantaraReceiptRegistry.test.ts` |
| Direct ETH transfer to contract reverts | `test/Qantara.test.ts` |
| Adversarial / reentrancy scenarios | `test/Adversarial.test.ts` |

## Manual review checklist

- [ ] Reentrancy: every value-moving function follows checks-effects-interactions and/or `nonReentrant`.
- [ ] Pull-payment: refunds credit `refundBalances` and require an explicit `withdrawRefund` (no push transfer in the refund path).
- [ ] `SafeERC20` used for all token transfers; fee-on-transfer / non-standard tokens considered.
- [ ] Native vs ERC-20 paths are isolated (`UseDedicatedERC20Path` guard) and cannot be crossed.
- [ ] Access control: merchant-only lifecycle actions revert `NotMerchant` for others.
- [ ] Integer/overflow: Solidity ^0.8 checked arithmetic; no unchecked blocks move value unsafely.
- [ ] Expiry handling: `expiresAt == 0` means no expiry; non-zero enforced on pay.
- [ ] No unbounded loops over user-controlled arrays in batch/splits paths.
- [ ] Events emitted for every state transition (indexer relies on these).
- [ ] Receipt registry is optional, issuer-gated, and never used as payment source of truth.
- [ ] Upgradeability: confirm contracts are non-upgradeable (immutable) as documented.

## Verification

- [ ] `npm run build` (hardhat compile) is green.
- [ ] `npm test` is green (unit + adversarial + fuzz).
- [ ] `node scripts/check-deploy-hardening.cjs` passes.
- [ ] `node scripts/regen-verified.cjs --check` and `node scripts/check-verified-manifest.cjs` confirm the published bundle matches source/bytecode/compiler/constructor metadata.

## Known limitations (disclosed)

See `../SECURITY.md` for the current self-audit, severity table, and the items
explicitly carried as known limitations (e.g. single-instance backend
persistence, explorer verification pending Sourcify/Etherscan support on QIE).
No external third-party audit has been completed; do not assume audited-grade
assurance for high-value throughput until one is.
