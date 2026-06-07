/**
 * One-off mainnet ops: deploy QantaraChat2771 (ERC-2771 gasless chat), allowlist
 * its sendMessage selector on the live QantaraGasRelay, then prove gasless
 * attribution end-to-end on QIE Mainnet (chain 1990).
 *
 *   merchant (relay owner, from .env.e2e) deploys + allowlists
 *   payer (.env.e2e) signs a ForwardRequest
 *   relayer (RELAYER_PK from ../backend/.env) submits execute() and pays gas
 *   assert the on-chain Message is attributed to the PAYER, not the relayer
 *
 * Writes the new address into deployments/qieMainnet.v4.json (gitignored).
 *
 * Run:  cd contracts && npx ts-node --transpileOnly scripts/deploy-chat2771-mainnet.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  JsonRpcProvider, Wallet, Contract, ContractFactory, Interface,
  toUtf8Bytes, hexlify, ZeroHash, getAddress, formatEther,
} from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const V4_PATH = path.join(__dirname, '..', 'deployments', 'qieMainnet.v4.json');
const V4 = JSON.parse(fs.readFileSync(V4_PATH, 'utf8'));
const RELAY_ADDR: string = V4.contracts.QantaraGasRelay;

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'v4', 'QantaraChat2771.sol', 'QantaraChat2771.json'), 'utf8'),
);
const RELAY_ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'v4', 'QantaraGasRelay.sol', 'QantaraGasRelay.json'), 'utf8'),
).abi;

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'qie' });
  const merchant = new Wallet(process.env.TEST_MERCHANT_PK!, provider); // relay owner
  const payer = new Wallet(process.env.TEST_PAYER_PK!, provider);
  const relayerPk = process.env.RELAYER_PK;
  if (!relayerPk) throw new Error('RELAYER_PK missing (../backend/.env)');
  const relayer = new Wallet(relayerPk, provider);

  console.log('='.repeat(70));
  console.log('Deploy QantaraChat2771 + wire gasless — QIE Mainnet (chain 1990)');
  console.log('='.repeat(70));
  console.log(`Relay     : ${RELAY_ADDR}`);
  console.log(`Merchant  : ${merchant.address} (deployer + relay owner) bal=${formatEther(await provider.getBalance(merchant.address))}`);
  console.log(`Payer     : ${payer.address} bal=${formatEther(await provider.getBalance(payer.address))}`);
  console.log(`Relayer   : ${relayer.address} bal=${formatEther(await provider.getBalance(relayer.address))}`);
  console.log('-'.repeat(70));

  // 1) Deploy (trustedForwarder = relay, owner = merchant)
  console.log('[1] Deploying QantaraChat2771 ...');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, merchant);
  const chat = await factory.deploy(RELAY_ADDR, merchant.address);
  await chat.waitForDeployment();
  const chatAddr = getAddress(await chat.getAddress());
  console.log(`    deployed at ${chatAddr}  (tx ${chat.deploymentTransaction()?.hash})`);

  const chatIface = new Interface(artifact.abi);
  const sel = chatIface.getFunction('sendMessage')!.selector;

  // 2) Allowlist sendMessage selector on the relay (merchant = owner)
  console.log('[2] Allowlisting sendMessage selector on relay ...');
  const relayOwner = new Contract(RELAY_ADDR, RELAY_ABI, merchant);
  const allowTx = await relayOwner.setSelectorAllowed(chatAddr, sel, true);
  await allowTx.wait();
  const allowed = await relayOwner.allowedSelectors(chatAddr, sel);
  console.log(`    selector ${sel} allowed=${allowed} (tx ${allowTx.hash})`);
  if (!allowed) throw new Error('selector not allowed after setSelectorAllowed');

  // 3) Payer signs ForwardRequest (domain name read from the live relay)
  console.log('[3] Payer signs ForwardRequest ...');
  const relayRead = new Contract(RELAY_ADDR, RELAY_ABI, provider);
  const domainName: string = (await relayRead.eip712Domain())[1];
  const nonce: bigint = await relayRead.nonces(payer.address);
  const data = chatIface.encodeFunctionData('sendMessage', [
    merchant.address, hexlify(toUtf8Bytes('gasless on-chain hello from payer')), ZeroHash,
  ]);
  const req = { from: payer.address, to: chatAddr, value: 0n, gas: 500000n, nonce, deadline: Math.floor(Date.now() / 1000) + 3600, data };
  const types = { ForwardRequest: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }, { name: 'data', type: 'bytes' },
  ]};
  const sig = await payer.signTypedData({ name: domainName, version: '1', chainId: CHAIN_ID, verifyingContract: RELAY_ADDR }, types, req);
  console.log(`    domain="${domainName}" nonce=${nonce}`);

  // 4) Relayer sponsors execute() — pays gas
  console.log('[4] Relayer sponsors execute() ...');
  const relayExec = new Contract(RELAY_ADDR, RELAY_ABI, relayer);
  const okPre = await relayExec.verify([req.from, req.to, req.value, req.gas, req.nonce, req.deadline, req.data], sig);
  console.log(`    relay.verify = ${okPre}`);
  if (!okPre) throw new Error('relay.verify returned false');
  const execTx = await relayExec.execute([req.from, req.to, req.value, req.gas, req.nonce, req.deadline, req.data], sig, { value: 0n, gasLimit: 700000n });
  const rcpt = await execTx.wait();
  console.log(`    execute tx ${rcpt.hash} gas=${rcpt.gasUsed}`);

  // 5) Assert Message attributed to PAYER (not relayer)
  console.log('[5] Verifying attribution ...');
  const parsed = rcpt.logs
    .map((l: any) => { try { return chatIface.parseLog(l); } catch { return null; } })
    .find((p: any) => p && p.name === 'Message');
  if (!parsed) throw new Error('no Message event emitted');
  const from = getAddress(parsed.args.from);
  console.log(`    Message.from = ${from}`);
  const correct = from === getAddress(payer.address);
  console.log(`    attributed to PAYER: ${correct ? 'YES ✅' : 'NO ❌'}  (relayer=${relayer.address})`);
  if (!correct) throw new Error('attribution failed — message not from payer');

  // 6) Persist address
  V4.contracts.QantaraChat2771 = chatAddr;
  fs.writeFileSync(V4_PATH, JSON.stringify(V4, null, 2) + '\n');
  console.log('-'.repeat(70));
  console.log(`DONE. QantaraChat2771 = ${chatAddr}`);
  console.log(`Set VITE_QANTARA_CHAT2771_ADDRESS=${chatAddr} (frontend) and QANTARA_CHAT2771_ADDRESS (backend).`);
  console.log(`Wrote address to deployments/qieMainnet.v4.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
