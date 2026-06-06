/**
 * Qantara — Live E2E test against deployed V3 contracts on QIE Mainnet (chain 1990).
 *
 * Two real wallets (TEST_MERCHANT_PK, TEST_PAYER_PK from .env.e2e) execute the full
 * invoice lifecycle: create / pay (native, ERC20, ERC20+permit) / cancel / pause / resume
 * / refund / withdraw + revert-paths. Each step records tx hash + gas + result; final
 * report printed as a table and written to scripts/e2e-report.json.
 *
 * Usage:
 *   cd contracts
 *   npx ts-node scripts/e2e-test.ts                 # full suite
 *   STEPS=native,erc20 npx ts-node scripts/e2e-test.ts   # subset
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  ContractFactory,
  Interface,
  Signature,
  formatEther,
  formatUnits,
  hexlify,
  randomBytes,
  ZeroAddress,
  ZeroHash,
} from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'deployments', 'qieMainnet.json'), 'utf8'),
);
const QANTARA_ADDR: string = DEPLOY.contracts.Qantara;
const QUSDC_ADDR: string = DEPLOY.contracts.QUSDC;

const QANTARA_ABI = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'artifacts', 'contracts', 'Qantara.sol', 'Qantara.json'),
    'utf8',
  ),
).abi;
const QANTARA_IFACE = new Interface(QANTARA_ABI);

function decodeRevertReason(e: any): string {
  // ethers v6: revert data lives in e.data or e.info.error.data or e.error.data
  const data =
    e?.data ??
    e?.info?.error?.data ??
    e?.error?.data ??
    e?.transaction?.data ??
    (typeof e?.message === 'string' && e.message.match(/0x[a-fA-F0-9]+/)?.[0]);
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const parsed = QANTARA_IFACE.parseError(data);
      if (parsed) {
        const args = parsed.args.map((a: any) => a?.toString?.() ?? String(a)).join(',');
        return `${parsed.name}(${args})`;
      }
    } catch {}
    return `unknown-selector:${data.slice(0, 10)}`;
  }
  return e?.shortMessage || e?.message || String(e);
}

const QUSDC_ART = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'artifacts', 'contracts', 'test', 'QUSDCTestToken.sol', 'QUSDCTestToken.json'),
    'utf8',
  ),
);
const QUSDC_ABI = QUSDC_ART.abi;

const PERMIT_ART = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'artifacts',
      'contracts',
      'test',
      'PermitToken.sol',
      'PermitToken.json',
    ),
    'utf8',
  ),
);

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const Status = ['Created', 'Paid', 'Cancelled', 'Refunded', 'Paused'] as const;

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
const newSalt = () => hexlify(randomBytes(32));

const STEPS_FILTER = (process.env.STEPS || '').split(',').filter(Boolean);
const runStep = (name: string) => STEPS_FILTER.length === 0 || STEPS_FILTER.includes(name);

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
    const r: Result = {
      name,
      ok: out.ok !== false,
      txHash,
      gasUsed,
      gasCostQIE,
      note: out.note,
    };
    results.push(r);
    process.stdout.write(r.ok ? 'OK' : 'EXPECTED-FAIL');
    if (txHash) process.stdout.write(`  tx=${txHash.slice(0, 10)}…  gas=${gasUsed}`);
    if (out.note) process.stdout.write(`  ${out.note}`);
    process.stdout.write('\n');
    return r;
  } catch (e: any) {
    const err = (e?.shortMessage || e?.message || String(e)).slice(0, 200);
    const r: Result = { name, ok: false, err };
    results.push(r);
    process.stdout.write(`ERR  ${err}\n`);
    return r;
  }
}

async function expectRevert(
  name: string,
  reasonMatch: string,
  fn: () => Promise<any>,
): Promise<Result> {
  process.stdout.write(`  [${name}] (expect revert ~${reasonMatch}) ... `);
  try {
    const tx = await fn();
    await tx.wait();
    const r: Result = { name, ok: false, err: 'no revert (unexpected success)' };
    results.push(r);
    process.stdout.write('UNEXPECTED-SUCCESS\n');
    return r;
  } catch (e: any) {
    const decoded = decodeRevertReason(e);
    const ok = decoded.toLowerCase().includes(reasonMatch.toLowerCase());
    const r: Result = {
      name,
      ok,
      note: `reverted: ${decoded.slice(0, 120)}`,
    };
    results.push(r);
    process.stdout.write(ok ? `OK (reverted: ${decoded})\n` : `WRONG-REVERT: ${decoded}\n`);
    return r;
  }
}

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'qie' });
  const merchantPK = process.env.TEST_MERCHANT_PK;
  const payerPK = process.env.TEST_PAYER_PK;
  if (!merchantPK || !payerPK)
    throw new Error('Missing TEST_MERCHANT_PK or TEST_PAYER_PK in .env.e2e');
  const merchant = new Wallet(merchantPK, provider);
  const payer = new Wallet(payerPK, provider);

  console.log('='.repeat(70));
  console.log('Qantara E2E — live mainnet (chain 1990)');
  console.log('='.repeat(70));
  console.log(
    `Merchant : ${merchant.address}  bal=${formatEther(await provider.getBalance(merchant.address))} QIE`,
  );
  console.log(
    `Payer    : ${payer.address}  bal=${formatEther(await provider.getBalance(payer.address))} QIE`,
  );
  console.log(`Qantara  : ${QANTARA_ADDR}`);
  console.log(`QUSDC    : ${QUSDC_ADDR}`);
  console.log('-'.repeat(70));

  const qantaraM = new Contract(QANTARA_ADDR, QANTARA_ABI, merchant);
  const qantaraP = new Contract(QANTARA_ADDR, QANTARA_ABI, payer);
  const qusdcP = new Contract(QUSDC_ADDR, QUSDC_ABI, payer);

  // ============ 1. NATIVE happy path ============
  if (runStep('native')) {
    console.log('\n[1] Native QIE — happy path');
    const salt = newSalt();
    const amount = 1000n;
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await record('native.create', async () => {
      const tx = await qantaraM.createInvoice(
        salt,
        ZeroAddress,
        amount,
        expiresAt,
        ZeroHash,
        InvoiceType.Standard,
      );
      return { tx };
    });
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);

    await record('native.pay', async () => {
      const tx = await qantaraP.payInvoiceNative(hash, { value: amount });
      return { tx, note: '1000 wei' };
    });
    await record('native.verify', async () => {
      const inv = await qantaraM.getInvoice(hash);
      const ok = Number(inv.status) === 1 && inv.payer.toLowerCase() === payer.address.toLowerCase();
      return { ok, note: `status=${Status[Number(inv.status)]} payer=${inv.payer.slice(0, 10)}…` };
    });
  }

  // ============ 2. ERC20 happy path ============
  if (runStep('erc20')) {
    console.log('\n[2] ERC20 (QUSDC) — happy path');
    await record('erc20.faucet', async () => {
      const tx = await qusdcP.faucet();
      return { tx, note: '1000 QUSDC minted to payer' };
    });
    const dec = Number(await qusdcP.decimals());
    const amount = 1000n;
    const salt = newSalt();

    await record('erc20.create', async () => {
      const tx = await qantaraM.createInvoice(
        salt,
        QUSDC_ADDR,
        amount,
        0n,
        ZeroHash,
        InvoiceType.Standard,
      );
      return { tx };
    });
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);

    await record('erc20.approve', async () => {
      const tx = await qusdcP.approve(QANTARA_ADDR, amount);
      return { tx };
    });
    const merchBalBefore: bigint = await qusdcP.balanceOf(merchant.address);
    await record('erc20.pay', async () => {
      const tx = await qantaraP.payInvoiceERC20(hash, amount);
      return { tx };
    });
    await record('erc20.verify', async () => {
      const inv = await qantaraM.getInvoice(hash);
      const merchBalAfter: bigint = await qusdcP.balanceOf(merchant.address);
      const delta: bigint = merchBalAfter - merchBalBefore;
      const ok = Number(inv.status) === 1 && delta === amount;
      return {
        ok,
        note: `delta=${formatUnits(delta, dec)} QUSDC status=${Status[Number(inv.status)]}`,
      };
    });
  }

  // ============ 3. PERMIT flow ============
  if (runStep('permit')) {
    console.log('\n[3] EIP-2612 Permit — deploy PermitToken + 1-tx pay');
    const PermitFactory = new ContractFactory(PERMIT_ART.abi, PERMIT_ART.bytecode, merchant);
    let permitToken: Contract | undefined;
    await record('permit.deploy', async () => {
      const c = await PermitFactory.deploy();
      await c.waitForDeployment();
      permitToken = c as unknown as Contract;
      return { tx: c.deploymentTransaction(), note: `at ${await c.getAddress()}` };
    });
    if (!permitToken) {
      console.log('  Skipping rest of permit suite (deploy failed)');
    } else {
      await record('permit.fundPayer', async () => {
        const tx = await (permitToken!.connect(merchant) as any).transfer(payer.address, 5000n);
        return { tx, note: '5000 PMT wei to payer' };
      });

      const amount = 1000n; // MIN_AMOUNT
      const salt = newSalt();
      const permitAddr = await permitToken.getAddress();
      await record('permit.create', async () => {
        const tx = await qantaraM.createInvoice(
          salt,
          permitAddr,
          amount,
          0n,
          ZeroHash,
          InvoiceType.Standard,
        );
        return { tx };
      });
      const invHash = await qantaraM.computeInvoiceHash(merchant.address, salt);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await (permitToken.connect(payer) as any).nonces(payer.address);
      const name = await permitToken.name();
      const domain = { name, version: '1', chainId: CHAIN_ID, verifyingContract: permitAddr };
      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const sig = await payer.signTypedData(domain, types, {
        owner: payer.address,
        spender: QANTARA_ADDR,
        value: amount,
        nonce,
        deadline,
      });
      const { v, r, s } = Signature.from(sig);

      await record('permit.pay', async () => {
        const tx = await qantaraP.payInvoiceERC20WithPermit(invHash, amount, deadline, v, r, s);
        return { tx, note: 'single-tx permit + transfer' };
      });
      await record('permit.verify', async () => {
        const inv = await qantaraM.getInvoice(invHash);
        return { ok: Number(inv.status) === 1, note: `status=${Status[Number(inv.status)]}` };
      });
    }
  }

  // ============ 4. CANCEL + revert ============
  if (runStep('cancel')) {
    console.log('\n[4] Cancel + WrongStatus revert');
    const salt = newSalt();
    await record('cancel.create', async () => {
      const tx = await qantaraM.createInvoice(
        salt,
        ZeroAddress,
        1000n,
        0n,
        ZeroHash,
        InvoiceType.Standard,
      );
      return { tx };
    });
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);
    await record('cancel.cancel', async () => ({ tx: await qantaraM.cancelInvoice(hash) }));
    await expectRevert('cancel.payAfter-reverts', 'WrongStatus', async () =>
      qantaraP.payInvoiceNative(hash, { value: 1000n }),
    );
  }

  // ============ 5. PAUSE / RESUME ============
  if (runStep('pause')) {
    console.log('\n[5] Pause / Resume');
    const salt = newSalt();
    await record('pause.create', async () => ({
      tx: await qantaraM.createInvoice(
        salt,
        ZeroAddress,
        1000n,
        0n,
        ZeroHash,
        InvoiceType.Standard,
      ),
    }));
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);
    await record('pause.pause', async () => ({ tx: await qantaraM.pauseInvoice(hash) }));
    await expectRevert('pause.payWhilePaused-reverts', 'WrongStatus', async () =>
      qantaraP.payInvoiceNative(hash, { value: 1000n }),
    );
    await record('pause.resume', async () => ({ tx: await qantaraM.resumeInvoice(hash) }));
    await record('pause.payAfterResume', async () => ({
      tx: await qantaraP.payInvoiceNative(hash, { value: 1000n }),
    }));
  }

  // ============ 6. EXPIRY ============
  if (runStep('expiry')) {
    console.log('\n[6] Expiry');
    const salt = newSalt();
    const exp = BigInt(Math.floor(Date.now() / 1000) - 60);
    await record('expiry.create', async () => ({
      tx: await qantaraM.createInvoice(
        salt,
        ZeroAddress,
        1000n,
        exp,
        ZeroHash,
        InvoiceType.Standard,
      ),
    }));
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);
    await expectRevert('expiry.pay-reverts', 'Expired', async () =>
      qantaraP.payInvoiceNative(hash, { value: 1000n }),
    );
  }

  // ============ 7. REFUND + WITHDRAW ============
  if (runStep('refund')) {
    console.log('\n[7] Refund + Withdraw cycle');
    const salt = newSalt();
    const amt = 1000n;
    await record('refund.create', async () => ({
      tx: await qantaraM.createInvoice(
        salt,
        ZeroAddress,
        amt,
        0n,
        ZeroHash,
        InvoiceType.Standard,
      ),
    }));
    const hash = await qantaraM.computeInvoiceHash(merchant.address, salt);
    await record('refund.pay', async () => ({
      tx: await qantaraP.payInvoiceNative(hash, { value: amt }),
    }));
    await record('refund.refund', async () => ({
      tx: await qantaraM.refundInvoice(hash, { value: amt }),
      note: 'merchant returns funds to contract',
    }));
    const balBefore = await provider.getBalance(payer.address);
    await record('refund.withdraw', async () => ({
      tx: await qantaraP.withdrawRefund(ZeroAddress),
    }));
    await record('refund.verify', async () => {
      const inv = await qantaraM.getInvoice(hash);
      const balAfter = await provider.getBalance(payer.address);
      const credited = await qantaraM.refundBalances(payer.address, ZeroAddress);
      // payer paid gas on withdraw tx, so balAfter ≈ balBefore + 1000 - gas. Just check state.
      const ok = Number(inv.status) === 3 && credited === 0n && balAfter > 0n;
      return { ok, note: `status=${Status[Number(inv.status)]} credited=${credited}` };
    });
  }

  // ============ 8. AmountMismatch + Donation ============
  if (runStep('amount')) {
    console.log('\n[8] AmountMismatch + Donation');
    const salt1 = newSalt();
    await record('amount.std.create', async () => ({
      tx: await qantaraM.createInvoice(
        salt1,
        ZeroAddress,
        1000n,
        0n,
        ZeroHash,
        InvoiceType.Standard,
      ),
    }));
    const h1 = await qantaraM.computeInvoiceHash(merchant.address, salt1);
    await expectRevert('amount.std.wrongAmount-reverts', 'AmountMismatch', async () =>
      qantaraP.payInvoiceNative(h1, { value: 999n }),
    );
    await record('amount.std.payCorrect', async () => ({
      tx: await qantaraP.payInvoiceNative(h1, { value: 1000n }),
    }));

    const salt2 = newSalt();
    await record('amount.don.create', async () => ({
      tx: await qantaraM.createInvoice(
        salt2,
        ZeroAddress,
        1000n,
        0n,
        ZeroHash,
        InvoiceType.Donation,
      ),
    }));
    const h2 = await qantaraM.computeInvoiceHash(merchant.address, salt2);
    await expectRevert('amount.don.belowMin-reverts', 'BelowMinimum', async () =>
      qantaraP.payInvoiceNative(h2, { value: 500n }),
    );
    await record('amount.don.payAboveMin', async () => ({
      tx: await qantaraP.payInvoiceNative(h2, { value: 1500n }),
      note: 'donation 1500 wei',
    }));
  }

  // ============ FINAL REPORT ============
  console.log('\n' + '='.repeat(70));
  console.log('FINAL REPORT');
  console.log('='.repeat(70));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
  console.log('-'.repeat(70));
  console.log(
    'Name'.padEnd(34),
    'OK'.padEnd(4),
    'Gas'.padEnd(10),
    'Cost(QIE)'.padEnd(14),
    'Note/Err',
  );
  console.log('-'.repeat(70));
  for (const r of results) {
    console.log(
      r.name.padEnd(34),
      (r.ok ? 'OK' : 'FAIL').padEnd(4),
      (r.gasUsed || '').padEnd(10),
      (r.gasCostQIE ? r.gasCostQIE.slice(0, 12) : '').padEnd(14),
      (r.note || r.err || '').slice(0, 60),
    );
  }
  const totalGasCost = results
    .filter((r) => r.gasCostQIE)
    .reduce((a, r) => a + Number(r.gasCostQIE), 0);
  console.log('-'.repeat(70));
  console.log(`Total gas spent: ${totalGasCost.toFixed(8)} QIE`);
  console.log('Final balances:');
  console.log(`  Merchant: ${formatEther(await provider.getBalance(merchant.address))} QIE`);
  console.log(`  Payer:    ${formatEther(await provider.getBalance(payer.address))} QIE`);

  fs.writeFileSync(
    path.join(__dirname, 'e2e-report.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        chainId: CHAIN_ID,
        merchant: merchant.address,
        payer: payer.address,
        qantara: QANTARA_ADDR,
        results,
        totalGasCostQIE: totalGasCost,
      },
      null,
      2,
    ),
  );
  console.log('\nWrote scripts/e2e-report.json');

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
