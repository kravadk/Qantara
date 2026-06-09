/**
 * Live mainnet e2e for the deployed BuyerEscrow (chain 1990).
 * Run: cd contracts && npx ts-node --transpileOnly scripts/e2e-test-buyerescrow.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { JsonRpcProvider, Wallet, Contract, hexlify, randomBytes, ZeroAddress, formatEther } from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const ADDR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'qieMainnet.buyerescrow.json'), 'utf8')).contracts.BuyerEscrow;
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'BuyerEscrow.sol', 'BuyerEscrow.json'), 'utf8')).abi;

async function main() {
  const p = new JsonRpcProvider(RPC, { chainId: 1990, name: 'qie' });
  const payer = new Wallet(process.env.TEST_PAYER_PK!, p);
  const merchant = new Wallet(process.env.TEST_MERCHANT_PK!, p);
  console.log('BuyerEscrow', ADDR, '| payer', payer.address, formatEther(await p.getBalance(payer.address)), 'QIE');

  const cP = new Contract(ADDR, ABI, payer);
  const amt = 1000n;

  // Flow 1: buyer release
  const s1 = hexlify(randomBytes(32));
  const id1 = await cP.computeDealId(payer.address, merchant.address, s1);
  console.log('[1] createEscrow + buyer confirmRelease');
  await (await cP.createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, 86400, s1, { value: amt })).wait();
  await (await cP.confirmRelease(id1)).wait();
  const d1 = await cP.getDeal(id1);
  console.log('    status =', d1.status.toString(), '(expect 1 = Released)');

  // Flow 2: merchant refund
  const s2 = hexlify(randomBytes(32));
  const id2 = await cP.computeDealId(payer.address, merchant.address, s2);
  console.log('[2] createEscrow + merchant refund');
  await (await cP.createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, 86400, s2, { value: amt })).wait();
  const cM = new Contract(ADDR, ABI, merchant);
  await (await cM.refund(id2)).wait();
  const d2 = await cP.getDeal(id2);
  console.log('    status =', d2.status.toString(), '(expect 2 = Refunded)');

  const ok = d1.status === 1n && d2.status === 2n;
  console.log(ok ? 'RESULT: PASS ✅' : 'RESULT: FAIL ❌');
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
