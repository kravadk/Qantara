/* eslint-disable no-console */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { requireQieMainnetRuntime, verificationEntry } from './deploy-hardening';

/**
 * Deploys the Qantara V4 ecosystem expansion contracts:
 *   - QantaraChat              (on-chain messaging)
 *   - QantaraSplits            (revenue sharing)
 *   - QantaraSubscriptionV2    (per-second token streaming)
 *   - QantaraGasRelay          (EIP-2771 forwarder for gasless UX)
 *
 * V1 / V1.5 contracts are not redeployed; V4 adds, never replaces.
 *
 * Required env: PRIVATE_KEY, QIE_RPC_URL
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const { chainId } = await ethers.provider.getNetwork();
  requireQieMainnetRuntime(network.name, chainId);

  console.log('============================================================');
  console.log(' Qantara - V4 deploy script');
  console.log('============================================================');
  console.log(` Network    : ${network.name} (chainId ${chainId})`);
  console.log(` Deployer   : ${deployer.address}`);
  console.log(` Balance    : ${ethers.formatEther(balance)} (native)`);
  console.log('------------------------------------------------------------');

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance. Fund the wallet before deploying.');
  }

  console.log('Deploying QantaraChat...');
  const CF = await ethers.getContractFactory('QantaraChat');
  const chat = await CF.deploy(deployer.address);
  await chat.waitForDeployment();
  const chatAddr = await chat.getAddress();
  console.log(`   QantaraChat            -> ${chatAddr}`);

  console.log('Deploying QantaraSplits...');
  const SF = await ethers.getContractFactory('QantaraSplits');
  const splits = await SF.deploy(deployer.address);
  await splits.waitForDeployment();
  const splitsAddr = await splits.getAddress();
  console.log(`   QantaraSplits          -> ${splitsAddr}`);

  console.log('Deploying QantaraSubscriptionV2...');
  const SubF = await ethers.getContractFactory('QantaraSubscriptionV2');
  const sub = await SubF.deploy(deployer.address);
  await sub.waitForDeployment();
  const subAddr = await sub.getAddress();
  console.log(`   QantaraSubscriptionV2  -> ${subAddr}`);

  console.log('Deploying QantaraGasRelay...');
  const RF = await ethers.getContractFactory('QantaraGasRelay');
  const relay = await RF.deploy(deployer.address);
  await relay.waitForDeployment();
  const relayAddr = await relay.getAddress();
  console.log(`   QantaraGasRelay        -> ${relayAddr}`);

  console.log('------------------------------------------------------------');

  const outputDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, `${network.name}.v4.json`);
  const manifest = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      QantaraChat: chatAddr,
      QantaraSplits: splitsAddr,
      QantaraSubscriptionV2: subAddr,
      QantaraGasRelay: relayAddr,
    },
    verification: {
      QantaraChat: verificationEntry([deployer.address]),
      QantaraSplits: verificationEntry([deployer.address]),
      QantaraSubscriptionV2: verificationEntry([deployer.address]),
      QantaraGasRelay: verificationEntry([deployer.address]),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestPath}`);

  console.log('============================================================');
  console.log(' Frontend env (append to qie-app/.env):');
  console.log('============================================================');
  console.log(`VITE_QANTARA_CHAT_ADDRESS=${chatAddr}`);
  console.log(`VITE_QANTARA_SPLITS_ADDRESS=${splitsAddr}`);
  console.log(`VITE_QANTARA_SUBSCRIPTION_V2_ADDRESS=${subAddr}`);
  console.log(`VITE_QANTARA_GAS_RELAY_ADDRESS=${relayAddr}`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
