/**
 * Qantara V15 — Live E2E against deployed v15 + MultiPay contracts on QIE Mainnet (chain 1990).
 *
 * Exercises every public state-changing path of the contracts that the v3/v4 suites skip:
 *   - QantaraMultiPay     (createInvoice, contributeNative, settleInvoice, cancelInvoice,
 *                          claimRefund, withdrawRefund + reverts)
 *   - MilestoneEscrow     (createEscrow, claimMilestone x tiers, refundRemainder + reverts)
 *   - RecurringScheduler  (createSubscription, accruedPeriods, claim-revert, cancel + reverts)
 *   - BatchPayout         (createBatch, claim, claimWithSignature [bearer], reclaim-revert + reverts)
 *
 * Two real wallets from contracts/.env.e2e. Native QIE, tiny wei amounts. State-based assertions.
 * Writes scripts/e2e-report-v15.json.
 *
 * Run:
 *   cd contracts
 *   npx ts-node --transpileOnly scripts/e2e-test-v15.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  AbiCoder,
  keccak256,
  id as keccakId,
  getBytes,
  hexlify,
  randomBytes,
  ZeroAddress,
  ZeroHash,
  formatEther,
} from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const V1 = readJson('deployments/qieMainnet.json');
const V15 = readJson('deployments/qieMainnet.v15.json');
const MULTIPAY_ADDR = V1.contracts.QantaraMultiPay as string;
const ESCROW_ADDR = V15.contracts.MilestoneEscrow as string;
const SCHED_ADDR = V15.contracts.RecurringScheduler as string;
const BATCH_ADDR = V15.contracts.BatchPayout as string;

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
}
function loadAbi(rel: string): any[] {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', rel), 'utf8')).abi;
}

const MULTIPAY_ABI = loadAbi('QantaraMultiPay.sol/QantaraMultiPay.json');
const ESCROW_ABI = loadAbi('MilestoneEscrow.sol/MilestoneEscrow.json');
const SCHED_ABI = loadAbi('RecurringScheduler.sol/RecurringScheduler.json');
const BATCH_ABI = loadAbi('BatchPayout.sol/BatchPayout.json');

// selector -> custom-error name, across all four ABIs. Some QIE RPC responses
// return the bare 4-byte error selector that ethers cannot auto-decode into the
// CALL_EXCEPTION message, so we decode it ourselves for revert assertions.
const ERROR_BY_SELECTOR: Record<string, string> = {};
for (const abi of [MULTIPAY_ABI, ESCROW_ABI, SCHED_ABI, BATCH_ABI]) {
  for (const f of abi as any[]) {
    if (f.type === 'error') {
      const sig = `${f.name}(${f.inputs.map((i: any) => i.type).join(',')})`;
      ERROR_BY_SELECTOR[keccakId(sig).slice(0, 10)] = f.name;
    }
  }
}

interface Row {
  name: string;
  ok: boolean;
  gas?: string;
  cost?: string;
  note?: string;
}
const rows: Row[] = [];
let totalGas = 0n;
let gasPrice = 0n;

function short(h: string): string {
  return h.length > 14 ? `${h.slice(0, 10)}…` : h;
}

async function record(name: string, fn: () => Promise<{ tx?: any; ok?: boolean; note?: string }>) {
  process.stdout.write(`  [${name}] ... `);
  try {
    const r = await fn();
    let gas: string | undefined;
    let cost: string | undefined;
    if (r.tx) {
      const receipt = await r.tx.wait();
      const used = receipt.gasUsed as bigint;
      totalGas += used;
      gas = used.toString();
      cost = formatEther(used * gasPrice);
      console.log(`OK  tx=${short(r.tx.hash)}  gas=${gas}${r.note ? '  ' + r.note : ''}`);
      rows.push({ name, ok: true, gas, cost, note: r.note });
    } else {
      const ok = r.ok !== false;
      console.log(`${ok ? 'OK' : 'FAIL'}${r.note ? '  ' + r.note : ''}`);
      rows.push({ name, ok, note: r.note });
    }
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || String(e);
    console.log(`ERR  ${msg}`);
    rows.push({ name, ok: false, note: msg });
  }
}

async function expectRevert(name: string, errName: string, staticCall: () => Promise<any>) {
  process.stdout.write(`  [${name}] (expect revert ~${errName}) ... `);
  try {
    await staticCall();
    console.log(`FAIL  did not revert`);
    rows.push({ name, ok: false, note: 'did not revert' });
  } catch (e: any) {
    const data: unknown = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    let decoded = '';
    if (typeof data === 'string' && data.length >= 10) decoded = ERROR_BY_SELECTOR[data.slice(0, 10)] || '';
    const hay = `${decoded} ${e?.revert?.name || ''} ${e?.shortMessage || ''} ${e?.message || ''}`;
    const hit = hay.includes(errName);
    const seen = decoded || e?.shortMessage || e?.message || String(e);
    console.log(`${hit ? 'OK' : 'FAIL'} (${hit ? 'reverted: ' + errName : 'wrong revert: ' + seen})`);
    rows.push({ name, ok: hit, note: hit ? `reverted: ${errName}` : `wrong: ${seen}` });
  }
}

const salt = () => hexlify(randomBytes(32));

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'qie' });
  const merchant = new Wallet(process.env.TEST_MERCHANT_PK!, provider);
  const payer = new Wallet(process.env.TEST_PAYER_PK!, provider);
  const fee = await provider.getFeeData();
  gasPrice = fee.gasPrice ?? 0n;

  const mBal = await provider.getBalance(merchant.address);
  const pBal = await provider.getBalance(payer.address);

  console.log('='.repeat(70));
  console.log('Qantara V15 E2E — live mainnet (chain 1990)');
  console.log('='.repeat(70));
  console.log(`Merchant : ${merchant.address}  bal=${formatEther(mBal)} QIE`);
  console.log(`Payer    : ${payer.address}  bal=${formatEther(pBal)} QIE`);
  console.log(`MultiPay : ${MULTIPAY_ADDR}`);
  console.log(`Escrow   : ${ESCROW_ADDR}`);
  console.log(`Sched    : ${SCHED_ADDR}`);
  console.log(`Batch    : ${BATCH_ADDR}`);
  console.log(`gasPrice : ${gasPrice} wei`);
  console.log('-'.repeat(70));

  // contracts bound to the relevant signer
  const mpM = new Contract(MULTIPAY_ADDR, MULTIPAY_ABI, merchant);
  const mpP = new Contract(MULTIPAY_ADDR, MULTIPAY_ABI, payer);
  const escP = new Contract(ESCROW_ADDR, ESCROW_ABI, payer);
  const escM = new Contract(ESCROW_ADDR, ESCROW_ABI, merchant);
  const scP = new Contract(SCHED_ADDR, SCHED_ABI, payer);
  const scM = new Contract(SCHED_ADDR, SCHED_ABI, merchant);
  const bpP = new Contract(BATCH_ADDR, BATCH_ABI, payer);
  const bpM = new Contract(BATCH_ADDR, BATCH_ABI, merchant);

  // ============ 1. QantaraMultiPay ============
  console.log('\n[1] QantaraMultiPay — happy settle + cancel/refund');
  {
    const s1 = salt();
    const hash1 = await mpM.computeInvoiceHash(merchant.address, s1);
    await record('multipay.createInvoice(native)', async () => ({
      tx: await mpM.createInvoice(s1, ZeroAddress, 0n, 0n, ZeroHash),
      note: `hash=${short(hash1)}`,
    }));
    await record('multipay.contributeNative(payer 2000 wei)', async () => ({
      tx: await mpP.contributeNative(hash1, { value: 2000n }),
    }));
    await record('multipay.getContribution==2000', async () => {
      const c = await mpM.getContribution(hash1, payer.address);
      return { ok: c === 2000n, note: `contribution=${c}` };
    });
    await record('multipay.settleInvoice(merchant)', async () => ({
      tx: await mpM.settleInvoice(hash1),
    }));
    await record('multipay.status==Settled', async () => {
      const inv = await mpM.getInvoice(hash1);
      return { ok: Number(inv.status) === 1, note: `status=${inv.status} raised=${inv.totalRaised}` };
    });

    // cancel + refund cycle
    const s2 = salt();
    const hash2 = await mpM.computeInvoiceHash(merchant.address, s2);
    await record('multipay.create#2', async () => ({ tx: await mpM.createInvoice(s2, ZeroAddress, 0n, 0n, ZeroHash) }));
    await record('multipay.contribute#2(payer 2000)', async () => ({ tx: await mpP.contributeNative(hash2, { value: 2000n }) }));
    await record('multipay.cancelInvoice(merchant)', async () => ({ tx: await mpM.cancelInvoice(hash2) }));
    await record('multipay.claimRefund(payer)', async () => ({ tx: await mpP.claimRefund(hash2) }));
    await record('multipay.withdrawRefund(payer,native)', async () => ({ tx: await mpP.withdrawRefund(ZeroAddress) }));
    await record('multipay.status#2==Cancelled', async () => {
      const inv = await mpM.getInvoice(hash2);
      return { ok: Number(inv.status) === 2, note: `status=${inv.status}` };
    });

    // reverts
    const s3 = salt();
    const hash3 = await mpM.computeInvoiceHash(merchant.address, s3);
    await mpM.createInvoice(s3, ZeroAddress, 0n, 0n, ZeroHash).then((t: any) => t.wait());
    await expectRevert('multipay.settle.byNonMerchant-reverts', 'NotMerchant', () => mpP.settleInvoice.staticCall(hash3));
    await expectRevert('multipay.contribute.belowMin-reverts', 'ZeroAmount', () =>
      mpP.contributeNative.staticCall(hash3, { value: 999n }),
    );
  }

  // ============ 2. MilestoneEscrow ============
  console.log('\n[2] MilestoneEscrow — fund, claim tiers, refund remainder');
  {
    const s = salt();
    const id = await escP.computeEscrowId(payer.address, merchant.address, s);
    await record('escrow.createEscrow(payer funds 4000)', async () => ({
      tx: await escP.createEscrow(merchant.address, ZeroAddress, ZeroAddress, 4000n, s, { value: 4000n }),
      note: `id=${short(id)}`,
    }));
    await record('escrow.previewNextMilestone==(0,1000)', async () => {
      const [tier, amount] = await escP.previewNextMilestone(id);
      return { ok: Number(tier) === 0 && amount === 1000n, note: `tier=${tier} amount=${amount}` };
    });
    await record('escrow.claimMilestone tier0 (merchant)', async () => ({ tx: await escM.claimMilestone(id), note: '+1000 (25%)' }));
    await record('escrow.claimMilestone tier1 (merchant)', async () => ({ tx: await escM.claimMilestone(id), note: '+1000 (50%)' }));
    await record('escrow.claimedAmount==2000', async () => {
      const e = await escP.getEscrow(id);
      return { ok: e.claimedAmount === 2000n, note: `claimed=${e.claimedAmount} nextTier=${e.nextTier}` };
    });
    await record('escrow.refundRemainder(merchant→payer 2000)', async () => ({ tx: await escM.refundRemainder(id) }));
    await record('escrow.status==Refunded', async () => {
      const e = await escP.getEscrow(id);
      return { ok: Number(e.status) === 2, note: `status=${e.status}` };
    });

    // reverts
    const s2 = salt();
    const id2 = await escP.computeEscrowId(payer.address, merchant.address, s2);
    await escP.createEscrow(merchant.address, ZeroAddress, ZeroAddress, 4000n, s2, { value: 4000n }).then((t: any) => t.wait());
    await expectRevert('escrow.claim.byNonMerchant-reverts', 'NotMerchant', () => escP.claimMilestone.staticCall(id2));
    await expectRevert('escrow.create.belowMin-reverts', 'ZeroAmount', () =>
      escP.createEscrow.staticCall(merchant.address, ZeroAddress, ZeroAddress, 999n, salt(), { value: 999n }),
    );
  }

  // ============ 3. RecurringScheduler ============
  console.log('\n[3] RecurringScheduler — create, accrual=0, claim-revert, cancel refund');
  {
    const s = salt();
    const id = await scP.computeSubId(payer.address, merchant.address, s);
    await record('sched.createSubscription(2×1000, interval=1h)', async () => ({
      tx: await scP.createSubscription(merchant.address, ZeroAddress, 1000n, 3600n, 2, s, { value: 2000n }),
      note: `id=${short(id)}`,
    }));
    await record('sched.accruedPeriods==0 (just created)', async () => {
      const a = await scP.accruedPeriods(id);
      return { ok: Number(a) === 0, note: `accrued=${a}` };
    });
    await expectRevert('sched.claim.noAccrual-reverts', 'NoPeriodsAccrued', () => scM.claim.staticCall(id));
    await record('sched.cancel(payer) → full refund (0 accrued)', async () => ({ tx: await scP.cancel(id) }));
    await record('sched.status==Cancelled', async () => {
      const sub = await scP.getSubscription(id);
      return { ok: Number(sub.status) === 2, note: `status=${sub.status} claimedPeriods=${sub.claimedPeriods}` };
    });
    await expectRevert('sched.create.intervalTooShort-reverts', 'IntervalTooShort', () =>
      scP.createSubscription.staticCall(merchant.address, ZeroAddress, 1000n, 60n, 2, salt(), { value: 2000n }),
    );
  }

  // ============ 4. BatchPayout ============
  console.log('\n[4] BatchPayout — create, claim, bearer claimWithSignature, reverts');
  {
    const bearer = Wallet.createRandom();
    const s = salt();
    const id = await bpP.computeBatchId(payer.address, s);
    const recipients = [merchant.address, bearer.address];
    const amounts = [1500n, 1200n];
    await record('batch.createBatch(payer funds 2700, 2 recipients)', async () => ({
      tx: await bpP.createBatch(ZeroAddress, recipients, amounts, 0n, s, { value: 2700n }),
      note: `id=${short(id)} bearer=${short(bearer.address)}`,
    }));
    await record('batch.entitlementOf(merchant)==1500', async () => {
      const e = await bpP.entitlementOf(id, merchant.address);
      return { ok: e === 1500n, note: `entitlement=${e}` };
    });
    await record('batch.claim(merchant) → 1500', async () => ({ tx: await bpM.claim(id) }));

    // bearer claim: bearer signs (batchId, recipient, chainid, contract); merchant submits, payer receives
    const recipient = payer.address;
    const inner = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256', 'address'],
        [id, recipient, CHAIN_ID, BATCH_ADDR],
      ),
    );
    const sig = await bearer.signMessage(getBytes(inner));
    await record('batch.claimWithSignature(bearer→payer 1200)', async () => ({
      tx: await bpM.claimWithSignature(id, bearer.address, recipient, sig),
      note: 'merchant sponsored, payer received',
    }));
    await record('batch.bearer entitlement cleared', async () => {
      const e = await bpP.entitlementOf(id, bearer.address);
      return { ok: e === 0n, note: `entitlement=${e}` };
    });

    // reverts
    await expectRevert('batch.claim.twice-reverts', 'NothingToClaim', () => bpM.claim.staticCall(id));
    await expectRevert('batch.reclaim.notExpired-reverts', 'NotExpired', () => bpP.reclaim.staticCall(id));
  }

  // ===== report =====
  const passed = rows.filter((r) => r.ok).length;
  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT — V15');
  console.log('='.repeat(70));
  console.log(`Total: ${rows.length}   Passed: ${passed}   Failed: ${rows.length - passed}`);
  console.log('-'.repeat(70));
  console.log('Name'.padEnd(46) + 'OK    Gas        Note/Err');
  console.log('-'.repeat(70));
  for (const r of rows) {
    console.log(
      r.name.padEnd(46) +
        (r.ok ? 'OK' : 'FAIL').padEnd(6) +
        (r.gas || '').padEnd(11) +
        (r.note || ''),
    );
  }
  console.log('-'.repeat(70));
  console.log(`Total gas spent: ${formatEther(totalGas * gasPrice)} QIE`);
  console.log(`Final balances:`);
  console.log(`  Merchant: ${formatEther(await provider.getBalance(merchant.address))} QIE`);
  console.log(`  Payer:    ${formatEther(await provider.getBalance(payer.address))} QIE`);

  fs.writeFileSync(
    path.join(__dirname, 'e2e-report-v15.json'),
    JSON.stringify({ chainId: CHAIN_ID, total: rows.length, passed, rows }, null, 2),
  );
  console.log('\nWrote scripts/e2e-report-v15.json');
  if (passed !== rows.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
