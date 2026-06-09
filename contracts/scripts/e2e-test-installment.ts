/**
 * Live mainnet e2e for the deployed InstallmentPlan (chain 1990).
 * payer + merchant from contracts/.env.e2e. Native QIE, tiny wei amounts.
 * Run: cd contracts && npx ts-node --transpileOnly scripts/e2e-test-installment.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { JsonRpcProvider, Wallet, Contract, hexlify, randomBytes, ZeroAddress, formatEther } from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const ADDR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'qieMainnet.installment.json'), 'utf8')).contracts.InstallmentPlan;
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'InstallmentPlan.sol', 'InstallmentPlan.json'), 'utf8')).abi;

async function main() {
  const p = new JsonRpcProvider(RPC, { chainId: 1990, name: 'qie' });
  const payer = new Wallet(process.env.TEST_PAYER_PK!, p);
  const merchant = new Wallet(process.env.TEST_MERCHANT_PK!, p);
  console.log('InstallmentPlan', ADDR);
  console.log('payer', payer.address, formatEther(await p.getBalance(payer.address)), 'QIE');

  const cP = new Contract(ADDR, ABI, payer);
  const cM = new Contract(ADDR, ABI, merchant);
  const salt = hexlify(randomBytes(32));
  const per = 1000n; // wei (== MIN_AMOUNT_PER_INSTALLMENT)
  const id = await cP.computePlanId(payer.address, merchant.address, salt);

  console.log('[1] createPlan (5 installments, native)');
  await (await cP.createPlan(merchant.address, ZeroAddress, per, 86400, 5, salt)).wait();

  console.log('[2] payInstallments x2');
  await (await cP.payInstallments(id, 2, { value: per * 2n })).wait();
  let plan = await cP.getPlan(id);
  console.log('    paid =', plan.paidInstallments.toString(), '(expect 2)');

  console.log('[3] merchant claimInstallments');
  await (await cM.claimInstallments(id)).wait();
  plan = await cP.getPlan(id);
  console.log('    claimed =', plan.claimedInstallments.toString(), '(expect 2)');

  console.log('[4] payer cancelPlan (no unclaimed left → refund 0)');
  await (await cP.cancelPlan(id)).wait();
  plan = await cP.getPlan(id);
  console.log('    status =', plan.status.toString(), '(expect 2 = Cancelled)');

  const ok = plan.paidInstallments === 2n && plan.claimedInstallments === 2n && plan.status === 2n;
  console.log(ok ? 'RESULT: PASS ✅' : 'RESULT: FAIL ❌');
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
