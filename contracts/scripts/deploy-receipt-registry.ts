/* eslint-disable no-console */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { requireQieMainnetRuntime, verificationEntry } from './deploy-hardening';

/**
 * Deploys the optional QantaraReceiptRegistry.
 *
 * The registry anchors backend-issued receipt hashes after verified payment.
 * It does not replace Qantara contract/indexer/RPC payment verification.
 *
 * Required env for qieMainnet:
 *   PRIVATE_KEY
 *   QIE_RPC_URL
 *
 * Optional env:
 *   QANTARA_RECEIPT_ISSUER_ADDRESS - backend/operator wallet allowed to anchor receipts
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const { chainId } = await ethers.provider.getNetwork();
  requireQieMainnetRuntime(network.name, chainId);

  console.log('============================================================');
  console.log(' Qantara - receipt registry deploy script');
  console.log('============================================================');
  console.log(` Network    : ${network.name} (chainId ${chainId})`);
  console.log(` Deployer   : ${deployer.address}`);
  console.log(` Balance    : ${ethers.formatEther(balance)} (native)`);
  console.log('------------------------------------------------------------');

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance. Fund the wallet before deploying.');
  }

  console.log('Deploying QantaraReceiptRegistry...');
  const Factory = await ethers.getContractFactory('QantaraReceiptRegistry');
  const registry = await Factory.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`   QantaraReceiptRegistry -> ${registryAddress}`);

  const configuredIssuer = process.env.QANTARA_RECEIPT_ISSUER_ADDRESS?.trim();
  let issuerAddress: string | null = null;
  if (configuredIssuer) {
    if (!ethers.isAddress(configuredIssuer) || configuredIssuer === ethers.ZeroAddress) {
      throw new Error('QANTARA_RECEIPT_ISSUER_ADDRESS must be a non-zero EVM address when provided.');
    }
    issuerAddress = ethers.getAddress(configuredIssuer);
    console.log(`Authorizing receipt issuer ${issuerAddress}...`);
    const tx = await registry.setIssuer(issuerAddress, true);
    await tx.wait();
  }

  console.log('------------------------------------------------------------');

  const outputDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${network.name}.receipt-registry.json`);
  const manifest = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      QantaraReceiptRegistry: registryAddress,
    },
    issuers: {
      owner: deployer.address,
      configured: issuerAddress,
    },
    verification: {
      QantaraReceiptRegistry: verificationEntry([deployer.address]),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);

  console.log('============================================================');
  console.log(' Backend env (append to backend/.env.production):');
  console.log('============================================================');
  console.log(`QANTARA_RECEIPT_REGISTRY_ADDRESS=${registryAddress}`);
  if (issuerAddress) console.log(`QANTARA_RECEIPT_ISSUER_ADDRESS=${issuerAddress}`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
