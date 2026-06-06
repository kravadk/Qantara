# Qantara - Smart Contracts

Hardhat workspace for QIE Mainnet (chain 1990).

## Contracts

| Contract | Purpose |
|---|---|
| `Qantara.sol` | Single-payer invoices. Standard (fixed amount) + Donation (open amount). Native QIE and ERC-20, including EIP-2612 permit and EIP-3009 transfer authorization payment paths. Pull-refund pattern. |
| `QantaraMultiPay.sol` | Collective invoices where multiple payers contribute to one invoice. Merchant settles or cancels. Pull-refund. |
| `test/QUSDCTestToken.sol` | ERC-20 token used only by the contract test suite. |

## Setup

```bash
cd contracts
npm install
cp .env.example .env
# Edit .env and fill in PRIVATE_KEY (deployer with enough QIE for gas)
```

Never commit `.env`. It is git-ignored. The deployer key should hold only what you need for gas; do not reuse a key that holds significant funds.

## Build / Test

```bash
npm run build
npm test
```

## Deploy

### Hardhat Network

```bash
npm run deploy:hardhat
```

This command uses the in-memory Hardhat network. It still requires a configured `QUSDC_ADDRESS`; use the deployed QUSDC address for rehearsing production configuration.

### QIE Mainnet (chain 1990)

```bash
npm run deploy:qie
```

Output:
- Console prints all three addresses and a copy-paste block for `qie-app/.env`.
- `deployments/qieMainnet.json` is written with the full manifest.

Set `QUSDC_ADDRESS=0x...` in `.env` before deploying. Production deployments do not deploy a token replacement, and the deploy script rejects missing or zero-address token configuration.

## Post-deploy: wire frontend

Copy the three `VITE_*` lines from deploy output into `qie-app/.env`:

```text
VITE_QANTARA_ADDRESS=0x...
VITE_QANTARA_MULTIPAY_ADDRESS=0x...
VITE_QUSDC_ADDRESS=0x...
```

Rebuild frontend: `cd ../qie-app && npm run build`.

## Architecture notes

- **Deterministic invoice hash**: `keccak256(merchant, salt, chainId, contractAddress)`. Lets the UI pre-compute the pay link before the tx is mined.
- **Pull-refund pattern**: cancel/refund credit funds to `refundBalances`. Payers withdraw via `withdrawRefund(token)`. Avoids unbounded gas loops.
- **CEI**: all state changes happen before external calls. `ReentrancyGuard` on every payable / withdraw.
- **SafeERC20**: tokens that don't return bool (USDT-style) work.
- **Native + ERC-20 isolation**: native and ERC-20 invoices use separate entry points (`payInvoiceNative` vs `payInvoiceERC20`). Cross-calls revert.

## Verify on explorer

QIE Mainnet block explorer (https://explorer.qie.digital) may or may not support Hardhat `verify`. If it accepts Sourcify/Etherscan-style verification, add the explorer endpoint to `hardhat.config.ts` under an `etherscan` config block. Otherwise upload sources manually; all contracts are MIT-licensed and self-contained besides OpenZeppelin 5.0 imports.
