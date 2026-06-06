import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, ZeroHash, randomBytes, hexlify } from 'ethers';
import { Qantara } from '../typechain-types';

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const Status = { Created: 0, Paid: 1, Cancelled: 2, Refunded: 3, Paused: 4 } as const;
const ITERATIONS = 24;

const newSalt = () => hexlify(randomBytes(32));

// Pseudo-random invoice amount in [1.000, 100.999] QIE. The invariants under
// test must hold for ALL valid inputs, so randomization is sound here.
function randAmount(): bigint {
  const whole = BigInt(Math.floor(Math.random() * 100) + 1);
  const frac = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return parseEther(`${whole}.${frac}`);
}

describe('Qantara — property/invariant fuzz', () => {
  let qantara: Qantara;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [merchant, payer, other] = await ethers.getSigners();
    const Qantara = await ethers.getContractFactory('Qantara');
    qantara = await Qantara.deploy(merchant.address);
  });

  it('invoice hash is deterministic and collision-free over random salts', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < ITERATIONS; i += 1) {
      const salt = newSalt();
      const h1 = await qantara.computeInvoiceHash(merchant.address, salt);
      const h2 = await qantara.computeInvoiceHash(merchant.address, salt);
      expect(h1).to.equal(h2);
      expect(seen.has(h1), 'hash collision').to.equal(false);
      seen.add(h1);
    }
  });

  it('exact-amount Standard: exact pays, underpay reverts, double-pay reverts', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const salt = newSalt();
      const amount = randAmount();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount - 1n }))
        .to.be.revertedWithCustomError(qantara, 'AmountMismatch');

      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });
      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Paid);
      expect(inv.paidAmount).to.equal(amount);
      expect(inv.payer).to.equal(payer.address);

      await expect(qantara.connect(other).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'WrongStatus');
    }
  });

  it('refund conservation: credited refunds equal payments and fully withdraw', async () => {
    let expectedTotal = 0n;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const salt = newSalt();
      const amount = randAmount();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);
      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });
      await qantara.connect(merchant).refundInvoice(hash, { value: amount });
      expect((await qantara.getInvoice(hash)).status).to.equal(Status.Refunded);
      expectedTotal += amount;
    }

    const credited = await qantara.refundBalances(payer.address, ZeroAddress);
    expect(credited).to.equal(expectedTotal);

    const before = await ethers.provider.getBalance(payer.address);
    const tx = await qantara.connect(payer).withdrawRefund(ZeroAddress);
    const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    const after = await ethers.provider.getBalance(payer.address);
    expect(after - before + gas).to.equal(credited);
    expect(await qantara.refundBalances(payer.address, ZeroAddress)).to.equal(0n);
  });

  it('donation invoices accept any amount at or above the minimum', async () => {
    const minimum = parseEther('0.1');
    for (let i = 0; i < ITERATIONS; i += 1) {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, minimum, 0, ZeroHash, InvoiceType.Donation);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);
      const pay = minimum + randAmount();
      await qantara.connect(payer).payInvoiceNative(hash, { value: pay });
      expect((await qantara.getInvoice(hash)).paidAmount).to.equal(pay);
    }
  });
});
