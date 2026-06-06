/* eslint-disable no-console */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import {
  requireConfiguredAddress,
  requireQieMainnetRuntime,
  verificationEntry,
} from './deploy-hardening';

/**
 * Deploys the Qantara stack.
 *
 * - QUSDC_ADDRESS must point to the production QUSDC token.
 * - Writes deployments/<network>.json with all addresses for the frontend.
 *
 * Required env:
 *   PRIVATE_KEY - deployer key with enough QIE for gas
 *   QIE_RPC_URL - RPC endpoint for QIE Mainnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const { chainId } = await ethers.provider.getNetwork();
  requireQieMainnetRuntime(network.name, chainId);

  console.log('============================================================');
  console.log(' Qantara - deploy script');
  console.log('============================================================');
  console.log(` Network    : ${network.name} (chainId ${chainId})`);
  console.log(` Deployer   : ${deployer.address}`);
  console.log(` Balance    : ${ethers.formatEther(balance)} (native)`);
  console.log('------------------------------------------------------------');

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance. Fund the wallet before deploying.');
  }

  const qusdcAddress = requireConfiguredAddress('QUSDC_ADDRESS');
  console.log(`Using configured QUSDC at ${qusdcAddress}`);

  console.log('Deploying Qantara...');
  const Qantara = await ethers.getContractFactory('Qantara');
  const qantara = await Qantara.deploy(deployer.address);
  await qantara.waitForDeployment();
  const qantaraAddress = await qantara.getAddress();
  console.log(`   Qantara         -> ${qantaraAddress}`);

  console.log('Deploying QantaraMultiPay...');
  const MultiPay = await ethers.getContractFactory('QantaraMultiPay');
  const multipay = await MultiPay.deploy(deployer.address);
  await multipay.waitForDeployment();
  const multipayAddress = await multipay.getAddress();
  console.log(`   QantaraMultiPay -> ${multipayAddress}`);

  console.log('------------------------------------------------------------');

  const outputDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${network.name}.json`);
  const manifest = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      Qantara: qantaraAddress,
      QantaraMultiPay: multipayAddress,
      QUSDC: qusdcAddress,
    },
    verification: {
      Qantara: verificationEntry([deployer.address]),
      QantaraMultiPay: verificationEntry([deployer.address]),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);

  console.log('============================================================');
  console.log(' Frontend env (paste into qie-app/.env):');
  console.log('============================================================');
  console.log(`VITE_QANTARA_ADDRESS=${qantaraAddress}`);
  console.log(`VITE_QANTARA_MULTIPAY_ADDRESS=${multipayAddress}`);
  console.log(`VITE_QUSDC_ADDRESS=${qusdcAddress}`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
