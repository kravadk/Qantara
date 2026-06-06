/* eslint-disable no-console */
import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import {
  requireManifestAddress,
  requireManifestChain,
  requireQieMainnetRuntime,
} from './deploy-hardening';

/**
 * One-time setup: whitelist (target, selector) pairs on QantaraGasRelay so the
 * relayer wallet can only sponsor the calls we expect. Anything else reverts at
 * the relay before consuming gas.
 *
 * Run after deploy-v4.ts.
 */
async function main() {
  const [owner] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  requireQieMainnetRuntime(network.name, chainId);

  const v4 = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.v4.json`), 'utf8'),
  );
  const v1 = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.json`), 'utf8'),
  );

  requireManifestChain(v4, network.name, chainId, `${network.name}.v4.json`);
  requireManifestChain(v1, network.name, chainId, `${network.name}.json`);

  const relayAddr = requireManifestAddress(v4, 'QantaraGasRelay');
  const chatAddr = requireManifestAddress(v4, 'QantaraChat');
  const splitsAddr = requireManifestAddress(v4, 'QantaraSplits');
  const subAddr = requireManifestAddress(v4, 'QantaraSubscriptionV2');
  const qantaraAddr = requireManifestAddress(v1, 'Qantara');

  console.log(`Configuring QantaraGasRelay ${relayAddr} as ${owner.address} on chain ${chainId}`);

  const relay = await ethers.getContractAt('QantaraGasRelay', relayAddr);

  const groups: Array<{ target: string; iface: any; methods: string[] }> = [
    {
      target: chatAddr,
      iface: (await ethers.getContractAt('QantaraChat', chatAddr)).interface,
      methods: ['sendMessage'],
    },
    {
      target: splitsAddr,
      iface: (await ethers.getContractAt('QantaraSplits', splitsAddr)).interface,
      methods: ['createSplit', 'updateSplit', 'distributeERC20', 'distributeNative', 'withdrawPull'],
    },
    {
      target: subAddr,
      iface: (await ethers.getContractAt('QantaraSubscriptionV2', subAddr)).interface,
      methods: ['createStream', 'withdraw', 'cancel'],
    },
    {
      target: qantaraAddr,
      iface: (await ethers.getContractAt('Qantara', qantaraAddr)).interface,
      methods: ['payInvoiceNative', 'payInvoiceERC20', 'payInvoiceERC20WithPermit'],
    },
  ];

  for (const g of groups) {
    const selectors: string[] = [];
    for (const m of g.methods) {
      const f = g.iface.getFunction(m);
      if (!f) {
        console.warn(`   skip ${m} (not found on ${g.target})`);
        continue;
      }
      selectors.push(f.selector);
    }
    if (selectors.length === 0) continue;
    console.log(`   ${g.target} -> ${selectors.length} selectors (${g.methods.join(', ')})`);
    const tx = await relay.setSelectorsBatch(g.target, selectors as any, true);
    const rcpt = await tx.wait();
    console.log(`      tx ${rcpt!.hash} (gas ${rcpt!.gasUsed.toString()})`);
  }

  console.log('Done. Whitelist active.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
