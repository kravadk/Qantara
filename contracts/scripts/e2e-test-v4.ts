/**
 * Qantara V4 — Live E2E test against deployed V4 contracts on QIE Mainnet (chain 1990).
 *
 * Tests every public function of:
 *   - QantaraChat           (sendMessage, conversationIdFor, messageCount, lastMessageAt)
 *   - QantaraSplits         (createSplit, getSplit, distributeNative, updateSplit, computeSplitId)
 *   - QantaraSubscriptionV2 (createStream, streamedSoFar, withdrawable, withdraw, cancel)
 *   - QantaraGasRelay       (verify, execute, setSelectorAllowed, allowedSelectors, nonces)
 *
 * Two real wallets from contracts/.env.e2e. Writes scripts/e2e-report-v4.json.
 *
 * Run:
 *   cd contracts
 *   npx ts-node --transpileOnly scripts/e2e-test-v4.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  Interface,
  formatEther,
  hexlify,
  randomBytes,
  ZeroAddress,
  ZeroHash,
  toUtf8Bytes,
  toUtf8String,
} from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const V4 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'deployments', 'qieMainnet.v4.json'), 'utf8'),
);
const V1 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'deployments', 'qieMainnet.json'), 'utf8'),
);
const CHAT_ADDR = V4.contracts.QantaraChat as string;
const SPLITS_ADDR = V4.contracts.QantaraSplits as string;
const SUB_ADDR = V4.contracts.QantaraSubscriptionV2 as string;
const RELAY_ADDR = V4.contracts.QantaraGasRelay as string;
const QUSDC_ADDR = V1.contracts.QUSDC as string;

const CHAT_ABI = loadAbi('v4/QantaraChat.sol/QantaraChat.json');
const SPLITS_ABI = loadAbi('v4/QantaraSplits.sol/QantaraSplits.json');
const SUB_ABI = loadAbi('v4/QantaraSubscriptionV2.sol/QantaraSubscriptionV2.json');
const RELAY_ABI = loadAbi('v4/QantaraGasRelay.sol/QantaraGasRelay.json');
const QUSDC_ABI = loadAbi('test/QUSDCTestToken.sol/QUSDCTestToken.json');

function loadAbi(rel: string): any[] {
  const j = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', rel), 'utf8'),
  );
  return j.abi;
}

const ALL_IFACES = [
  new Interface(CHAT_ABI),
  new Interface(SPLITS_ABI),
  new Interface(SUB_ABI),
  new Interface(RELAY_ABI),
  new Interface(QUSDC_ABI),
];

function tryParseSelector(data: string): string | null {
  for (const iface of ALL_IFACES) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        const args = parsed.args.map((a: any) => a?.toString?.() ?? String(a)).join(',');
        return `${parsed.name}(${args})`;
      }
    } catch {}
  }
  return null;
}

function decodeRevert(e: any): string {
  const candidates: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string' && v.startsWith('0x') && v.length >= 10) candidates.push(v);
  };
  push(e?.data);
  push(e?.info?.error?.data);
  push(e?.error?.data);
  push(e?.revert?.data);
  // The relay wraps inner reverts as CallReverted(bytes). Unwrap one level if present.
  for (const c of [...candidates]) {
    const parsed = tryParseSelector(c);
    if (parsed && parsed.startsWith('CallReverted(')) {
      // CallReverted payload: extract inner bytes (last arg).
      try {
        const inner = parsed.match(/CallReverted\(([0-9a-fx]+)\)/)?.[1];
        if (inner) candidates.push(inner);
      } catch {}
    }
  }
  // Also scrape any 0x… selectors from message text (fallback for ethers v6 errors).
  if (typeof e?.message === 'string') {
    const m = e.message.matchAll(/0x[a-fA-F0-9]{8,}/g);
    for (const x of m) candidates.push(x[0]);
  }
  for (const c of candidates) {
    const parsed = tryParseSelector(c);
    if (parsed) return parsed;
  }
  return e?.shortMessage || e?.message || String(e);
}

type Result = {
  name: string;
  ok: boolean;
  txHash?: string;
  gasUsed?: string;
  gasCostQIE?: string;
  note?: string;
  err?: string;
};

const results: Result[] = [];

async function record(
  name: string,
  fn: () => Promise<{ tx?: any; note?: string; ok?: boolean }>,
): Promise<Result> {
  process.stdout.write(`  [${name}] ... `);
  try {
    const out = await fn();
    let txHash: string | undefined;
    let gasUsed: string | undefined;
    let gasCostQIE: string | undefined;
    if (out.tx) {
      const rcpt = await out.tx.wait();
      txHash = rcpt.hash;
      gasUsed = rcpt.gasUsed.toString();
      const gasPrice = rcpt.gasPrice ?? out.tx.gasPrice ?? 0n;
      gasCostQIE = formatEther((rcpt.gasUsed as bigint) * (gasPrice as bigint));
    }
    const r: Result = { name, ok: out.ok !== false, txHash, gasUsed, gasCostQIE, note: out.note };
    results.push(r);
    process.stdout.write(r.ok ? 'OK' : 'FAIL');
    if (txHash) process.stdout.write(`  tx=${txHash.slice(0, 10)}…  gas=${gasUsed}`);
    if (out.note) process.stdout.write(`  ${out.note}`);
    process.stdout.write('\n');
    return r;
  } catch (e: any) {
    const err = decodeRevert(e).slice(0, 200);
    const r: Result = { name, ok: false, err };
    results.push(r);
    process.stdout.write(`ERR  ${err}\n`);
    return r;
  }
}

async function expectRevert(
  name: string,
  match: string,
  fn: () => Promise<any>,
): Promise<Result> {
  process.stdout.write(`  [${name}] (expect revert ~${match}) ... `);
  try {
    const tx = await fn();
    await tx.wait();
    const r: Result = { name, ok: false, err: 'no revert (unexpected success)' };
    results.push(r);
    process.stdout.write('UNEXPECTED-SUCCESS\n');
    return r;
  } catch (e: any) {
    const decoded = decodeRevert(e);
    const ok = decoded.toLowerCase().includes(match.toLowerCase());
    const r: Result = { name, ok, note: `reverted: ${decoded.slice(0, 120)}` };
    results.push(r);
    process.stdout.write(ok ? `OK (${decoded})\n` : `WRONG-REVERT: ${decoded}\n`);
    return r;
  }
}

/**
 * Use staticCall to provoke the revert at simulation time, where ethers reliably
 * surfaces revert data (mainnet sendTransaction often drops it on failed inclusion).
 */
async function expectStaticRevert<T>(
  name: string,
  match: string,
  fn: () => Promise<T>,
): Promise<Result> {
  process.stdout.write(`  [${name}] (expect static-revert ~${match}) ... `);
  try {
    await fn();
    const r: Result = { name, ok: false, err: 'no revert (staticCall succeeded)' };
    results.push(r);
    process.stdout.write('UNEXPECTED-SUCCESS\n');
    return r;
  } catch (e: any) {
    const decoded = decodeRevert(e);
    const ok = decoded.toLowerCase().includes(match.toLowerCase());
    const r: Result = { name, ok, note: `reverted: ${decoded.slice(0, 120)}` };
    results.push(r);
    process.stdout.write(ok ? `OK (${decoded})\n` : `WRONG-REVERT: ${decoded}\n`);
    return r;
  }
}

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'qie' });
  const merchant = new Wallet(process.env.TEST_MERCHANT_PK!, provider);
  const payer = new Wallet(process.env.TEST_PAYER_PK!, provider);

  console.log('='.repeat(70));
  console.log('Qantara V4 E2E — live mainnet (chain 1990)');
  console.log('='.repeat(70));
  console.log(`Merchant : ${merchant.address}  bal=${formatEther(await provider.getBalance(merchant.address))} QIE`);
  console.log(`Payer    : ${payer.address}  bal=${formatEther(await provider.getBalance(payer.address))} QIE`);
  console.log(`Chat     : ${CHAT_ADDR}`);
  console.log(`Splits   : ${SPLITS_ADDR}`);
  console.log(`Streams  : ${SUB_ADDR}`);
  console.log(`Relay    : ${RELAY_ADDR}`);
  console.log('-'.repeat(70));

  const chatM = new Contract(CHAT_ADDR, CHAT_ABI, merchant);
  const chatP = new Contract(CHAT_ADDR, CHAT_ABI, payer);
  const splitsM = new Contract(SPLITS_ADDR, SPLITS_ABI, merchant);
  const splitsP = new Contract(SPLITS_ADDR, SPLITS_ABI, payer);
  const subM = new Contract(SUB_ADDR, SUB_ABI, merchant);
  const subP = new Contract(SUB_ADDR, SUB_ABI, payer);
  const relayM = new Contract(RELAY_ADDR, RELAY_ABI, merchant);

  // ============ 1. QantaraChat ============
  console.log('\n[1] QantaraChat');

  await record('chat.conversationIdFor.symmetric', async () => {
    const cAB = await chatM.conversationIdFor(merchant.address, payer.address);
    const cBA = await chatM.conversationIdFor(payer.address, merchant.address);
    return { ok: cAB === cBA, note: `cid=${cAB.slice(0, 14)}…` };
  });

  const greeting = 'hi from merchant ' + Date.now();
  const meta1 = '0x' + 'aa'.repeat(32);
  await record('chat.sendMessage(merchant→payer)', async () => {
    const tx = await chatM.sendMessage(payer.address, hexlify(toUtf8Bytes(greeting)), meta1);
    return { tx, note: `body="${greeting}"` };
  });

  const cid = await chatM.conversationIdFor(merchant.address, payer.address);
  const afterFirstCount: bigint = await chatM.messageCount(cid);
  await record('chat.messageCount.increased', async () => {
    return { ok: afterFirstCount >= 1n, note: `count=${afterFirstCount}` };
  });

  await record('chat.lastMessageAt>0', async () => {
    const t = await chatM.lastMessageAt(cid);
    return { ok: t > 0n, note: `ts=${t}` };
  });

  await record('chat.sendMessage(payer→merchant)', async () => {
    const tx = await chatP.sendMessage(merchant.address, hexlify(toUtf8Bytes('hi back')), ZeroHash, { gasLimit: 120_000n });
    return { tx };
  });

  const afterSecondCount: bigint = await chatM.messageCount(cid);
  await record('chat.messageCount.incrementsAfterReply', async () => {
    return { ok: afterSecondCount === afterFirstCount + 1n, note: `${afterFirstCount} → ${afterSecondCount}` };
  });

  await record('chat.eventLog.contains(both)', async () => {
    const filter = chatM.filters.Message(cid);
    const logs = await chatM.queryFilter(filter, -2000);
    const bodies = logs.map((l: any) => {
      try { return toUtf8String(l.args.ciphertext); } catch { return ''; }
    });
    const ok = bodies.includes(greeting) && bodies.includes('hi back');
    return { ok, note: `events=${logs.length}` };
  });

  await expectRevert('chat.empty-reverts', 'EmptyBody', async () =>
    chatM.sendMessage(payer.address, '0x', ZeroHash),
  );
  await expectRevert('chat.self-reverts', 'CannotMessageSelf', async () =>
    chatM.sendMessage(merchant.address, '0x01', ZeroHash),
  );
  await expectRevert('chat.zeroRecipient-reverts', 'InvalidRecipient', async () =>
    chatM.sendMessage(ZeroAddress, '0x01', ZeroHash),
  );

  // ============ 2. QantaraSplits ============
  console.log('\n[2] QantaraSplits');

  const salt = hexlify(randomBytes(32));
  const recipients = [merchant.address, payer.address];
  const shares = [6000, 4000];

  let splitId: string = ZeroHash;
  await record('splits.computeSplitId', async () => {
    splitId = await splitsM.computeSplitId(recipients, shares, salt);
    return { ok: splitId !== ZeroHash, note: splitId.slice(0, 14) + '…' };
  });

  await record('splits.createSplit', async () => {
    const tx = await splitsM.createSplit(recipients, shares, merchant.address, salt);
    return { tx };
  });

  await record('splits.getSplit', async () => {
    const s = await splitsM.getSplit(splitId);
    const ok = s.controller.toLowerCase() === merchant.address.toLowerCase()
      && Number(s.sharesBps[0]) === 6000
      && Number(s.sharesBps[1]) === 4000;
    return { ok, note: `controller=${s.controller.slice(0, 8)}…` };
  });

  const balM0 = await provider.getBalance(merchant.address);
  await record('splits.distributeNative', async () => {
    const tx = await splitsP.distributeNative(splitId, { value: 10000n });
    return { tx, note: '10000 wei distributed' };
  });
  await record('splits.distribution.verify', async () => {
    const balM1 = await provider.getBalance(merchant.address);
    const deltaM = balM1 - balM0;
    const ok = deltaM === 6000n;
    return { ok, note: `merchant delta=${deltaM} (expected +6000)` };
  });

  await record('splits.updateSplit', async () => {
    const tx = await splitsM.updateSplit(splitId, recipients, [7000, 3000]);
    return { tx };
  });
  await record('splits.update.verify', async () => {
    const s = await splitsM.getSplit(splitId);
    return { ok: Number(s.sharesBps[0]) === 7000, note: `new shares[0]=${s.sharesBps[0]}` };
  });

  await expectRevert('splits.update.byNonController-reverts', 'NotController', async () =>
    splitsP.updateSplit(splitId, recipients, [5000, 5000]),
  );

  await expectRevert('splits.createSplit.badBps-reverts', 'SharesSumMismatch', async () =>
    splitsM.createSplit(recipients, [5000, 4000], merchant.address, hexlify(randomBytes(32))),
  );

  // ============ 3. QantaraSubscriptionV2 ============
  console.log('\n[3] QantaraSubscriptionV2 (streaming)');

  const ratePerSec = 1n;
  const durSec = 60;
  const blockNow = Number((await provider.getBlock('latest'))!.timestamp);
  const startsAt = blockNow + 2;
  const endsAt = startsAt + durSec;
  const total = ratePerSec * BigInt(durSec);

  await record('streams.createStream', async () => {
    const tx = await subM.createStream(payer.address, ZeroAddress, ratePerSec, startsAt, endsAt, { value: total });
    return { tx, note: `${ratePerSec} wei/s × ${durSec}s = ${total} wei` };
  });

  const streamId = await subM.nextStreamId();
  console.log(`     streamId=${streamId}`);

  console.log('     waiting 20s for stream to accrue…');
  await new Promise((r) => setTimeout(r, 20_000));

  await record('streams.streamedSoFar>0', async () => {
    const s = await subM.streamedSoFar(streamId);
    return { ok: s > 0n, note: `accrued=${s} wei` };
  });

  await record('streams.withdrawable>0', async () => {
    const w = await subM.withdrawable(streamId);
    return { ok: w > 0n, note: `withdrawable=${w} wei` };
  });

  await record('streams.withdraw(recipient)', async () => {
    const tx = await subP.withdraw(streamId);
    return { tx };
  });

  await expectRevert('streams.withdraw.byNonRecipient-reverts', 'NotRecipient', async () =>
    subM.withdraw(streamId),
  );

  await record('streams.cancel(payer)', async () => {
    const tx = await subM.cancel(streamId, { gasLimit: 200_000n });
    return { tx };
  });

  await expectStaticRevert('streams.cancel.twice-reverts', 'AlreadyCancelled', async () =>
    subM.cancel.staticCall(streamId),
  );

  await expectRevert('streams.create.invalidWindow-reverts', 'InvalidWindow', async () =>
    subM.createStream(payer.address, ZeroAddress, 1n, blockNow, blockNow, { value: 0 }),
  );
  await expectRevert('streams.create.selfStream-reverts', 'InvalidWindow', async () =>
    subM.createStream(merchant.address, ZeroAddress, 1n, blockNow + 1, blockNow + 100, { value: 100n }),
  );
  await expectRevert('streams.create.wrongValue-reverts', 'WrongValue', async () =>
    subM.createStream(payer.address, ZeroAddress, 1n, blockNow + 1, blockNow + 100, { value: 50n }),
  );

  // ============ 4. QantaraGasRelay ============
  console.log('\n[4] QantaraGasRelay');

  const sendMsgSel = chatM.interface.getFunction('sendMessage')!.selector;
  await record('relay.allowedSelectors(Chat.sendMessage)=true', async () => {
    const allowed = await relayM.allowedSelectors(CHAT_ADDR, sendMsgSel);
    return { ok: allowed === true, note: `selector=${sendMsgSel}` };
  });

  const nonce: bigint = await relayM.nonces(payer.address);
  // Read the live EIP-712 domain name from the deployed contract instead of
  // hardcoding it: the on-chain QantaraGasRelay was deployed under the legacy
  // pre-rebrand name "PayLinkGasRelay", so a hardcoded "QantaraGasRelay" domain
  // produces a signature the contract cannot verify.
  const relayDomainName: string = (await relayM.eip712Domain())[1];
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const innerData = chatM.interface.encodeFunctionData('sendMessage', [
    merchant.address,
    hexlify(toUtf8Bytes('gasless hello ' + Date.now())),
    ZeroHash,
  ]);
  const req = {
    from: payer.address,
    to: CHAT_ADDR,
    value: 0n,
    gas: 500_000n,
    nonce,
    deadline,
    data: innerData,
  };
  const domain = {
    name: relayDomainName,
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: RELAY_ADDR,
  };
  const types = {
    ForwardRequest: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'gas', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
      { name: 'data', type: 'bytes' },
    ],
  };
  const sig = await payer.signTypedData(domain, types, req);

  await record('relay.verify(validSig)=true', async () => {
    const ok = await relayM.verify(
      [req.from, req.to, req.value, req.gas, req.nonce, req.deadline, req.data],
      sig,
    );
    return { ok, note: `nonce=${nonce}` };
  });

  await record('relay.execute(merchantSponsors)', async () => {
    const tx = await relayM.execute(
      [req.from, req.to, req.value, req.gas, req.nonce, req.deadline, req.data],
      sig,
      { value: 0n, gasLimit: 700_000n },
    );
    return { tx, note: 'merchant paid gas for payer-signed call' };
  });

  await record('relay.nonces.incremented', async () => {
    const newNonce = await relayM.nonces(payer.address);
    return { ok: newNonce === nonce + 1n, note: `nonce: ${nonce} → ${newNonce}` };
  });

  // Use staticCall to reliably get revert data from mainnet RPC.
  await expectStaticRevert('relay.replay-reverts', 'InvalidSignature', async () =>
    relayM.execute.staticCall(
      [req.from, req.to, req.value, req.gas, req.nonce, req.deadline, req.data],
      sig,
      { value: 0n },
    ),
  );

  // non-whitelisted selector
  const invalidData = '0xdeadbeef' + '00'.repeat(32);
  const nonceForInvalidData: bigint = await relayM.nonces(payer.address);
  const badReq = { ...req, nonce: nonceForInvalidData, data: invalidData };
  const badSig = await payer.signTypedData(domain, types, badReq);
  await expectStaticRevert('relay.unknownSelector-reverts', 'SelectorNotAllowed', async () =>
    relayM.execute.staticCall(
      [badReq.from, badReq.to, badReq.value, badReq.gas, badReq.nonce, badReq.deadline, badReq.data],
      badSig,
      { value: 0n },
    ),
  );

  // expired deadline
  const nonceForExp: bigint = await relayM.nonces(payer.address);
  const expiredReq = { ...req, nonce: nonceForExp, deadline: Math.floor(Date.now() / 1000) - 60 };
  const expiredSig = await payer.signTypedData(domain, types, expiredReq);
  await expectStaticRevert('relay.expired-reverts', 'ExpiredRequest', async () =>
    relayM.execute.staticCall(
      [expiredReq.from, expiredReq.to, expiredReq.value, expiredReq.gas, expiredReq.nonce, expiredReq.deadline, expiredReq.data],
      expiredSig,
      { value: 0n },
    ),
  );

  // owner-only: setSelectorAllowed
  const unrelatedSel = '0x12345678';
  await record('relay.setSelectorAllowed(owner)', async () => {
    const tx = await relayM.setSelectorAllowed(CHAT_ADDR, unrelatedSel, true);
    return { tx };
  });
  await record('relay.setSelectorAllowed.verify', async () => {
    const allowed = await relayM.allowedSelectors(CHAT_ADDR, unrelatedSel);
    return { ok: allowed === true };
  });
  await record('relay.setSelectorAllowed.unset', async () => {
    const tx = await relayM.setSelectorAllowed(CHAT_ADDR, unrelatedSel, false);
    return { tx };
  });

  // ============ FINAL ============
  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT — V4');
  console.log('='.repeat(70));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
  console.log('-'.repeat(70));
  console.log('Name'.padEnd(48), 'OK'.padEnd(5), 'Gas'.padEnd(10), 'Cost(QIE)'.padEnd(14), 'Note/Err');
  console.log('-'.repeat(70));
  for (const r of results) {
    console.log(
      r.name.padEnd(48),
      (r.ok ? 'OK' : 'FAIL').padEnd(5),
      (r.gasUsed || '').padEnd(10),
      (r.gasCostQIE ? r.gasCostQIE.slice(0, 12) : '').padEnd(14),
      (r.note || r.err || '').slice(0, 60),
    );
  }
  const totalGas = results
    .filter((r) => r.gasCostQIE)
    .reduce((a, r) => a + Number(r.gasCostQIE), 0);
  console.log('-'.repeat(70));
  console.log(`Total gas spent: ${totalGas.toFixed(8)} QIE`);
  console.log('Final balances:');
  console.log(`  Merchant: ${formatEther(await provider.getBalance(merchant.address))} QIE`);
  console.log(`  Payer:    ${formatEther(await provider.getBalance(payer.address))} QIE`);

  fs.writeFileSync(
    path.join(__dirname, 'e2e-report-v4.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        chainId: CHAIN_ID,
        merchant: merchant.address,
        payer: payer.address,
        contracts: { chat: CHAT_ADDR, splits: SPLITS_ADDR, streams: SUB_ADDR, relay: RELAY_ADDR },
        results,
        totalGasCostQIE: totalGas,
      },
      null,
      2,
    ),
  );
  console.log('\nWrote scripts/e2e-report-v4.json');

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
