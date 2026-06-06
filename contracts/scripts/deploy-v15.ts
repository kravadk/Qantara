/* eslint-disable no-console */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { requireQieMainnetRuntime, verificationEntry } from './deploy-hardening';

/**
 * Deploys the Qantara V1.5 contracts:
 *   - MilestoneEscrow
 *   - RecurringScheduler
 *   - BatchPayout
 *
 * V1 contracts (Qantara, QantaraMultiPay, QUSDC) are not redeployed;
 * see deployments/<network>.json for deployed addresses.
 *
 * Required env: PRIVATE_KEY, QIE_RPC_URL
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const { chainId } = await ethers.provider.getNetwork();
  requireQieMainnetRuntime(network.name, chainId);

  console.log('============================================================');
  console.log(' Qantara - V1.5 deploy script');
  console.log('============================================================');
  console.log(` Network    : ${network.name} (chainId ${chainId})`);
  console.log(` Deployer   : ${deployer.address}`);
  console.log(` Balance    : ${ethers.formatEther(balance)} (native)`);
  console.log('------------------------------------------------------------');

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance. Fund the wallet before deploying.');
  }

  console.log('Deploying MilestoneEscrow...');
  const E = await ethers.getContractFactory('MilestoneEscrow');
  const escrow = await E.deploy(deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`   MilestoneEscrow     -> ${escrowAddress}`);

  console.log('Deploying RecurringScheduler...');
  const S = await ethers.getContractFactory('RecurringScheduler');
  const scheduler = await S.deploy(deployer.address);
  await scheduler.waitForDeployment();
  const schedulerAddress = await scheduler.getAddress();
  console.log(`   RecurringScheduler  -> ${schedulerAddress}`);

  console.log('Deploying BatchPayout...');
  const B = await ethers.getContractFactory('BatchPayout');
  const batch = await B.deploy(deployer.address);
  await batch.waitForDeployment();
  const batchAddress = await batch.getAddress();
  console.log(`   BatchPayout         -> ${batchAddress}`);

  console.log('------------------------------------------------------------');

  const outputDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${network.name}.v15.json`);
  const manifest = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      MilestoneEscrow: escrowAddress,
      RecurringScheduler: schedulerAddress,
      BatchPayout: batchAddress,
    },
    verification: {
      MilestoneEscrow: verificationEntry([deployer.address]),
      RecurringScheduler: verificationEntry([deployer.address]),
      BatchPayout: verificationEntry([deployer.address]),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);

  console.log('============================================================');
  console.log(' Frontend env (append to qie-app/.env):');
  console.log('============================================================');
  console.log(`VITE_MILESTONE_ESCROW_ADDRESS=${escrowAddress}`);
  console.log(`VITE_RECURRING_SCHEDULER_ADDRESS=${schedulerAddress}`);
  console.log(`VITE_BATCH_PAYOUT_ADDRESS=${batchAddress}`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
