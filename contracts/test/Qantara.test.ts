import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, parseUnits, ZeroAddress, ZeroHash, randomBytes, hexlify } from 'ethers';
import { Qantara, QUSDCTestToken } from '../typechain-types';

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const Status = { Created: 0, Paid: 1, Cancelled: 2, Refunded: 3, Paused: 4 } as const;

describe('Qantara', () => {
  let qantara: Qantara;
  let qusdc: QUSDCTestToken;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [merchant, payer, other] = await ethers.getSigners();
    const Qantara = await ethers.getContractFactory('Qantara');
    qantara = await Qantara.deploy(merchant.address);
    const QUSDC = await ethers.getContractFactory('QUSDCTestToken');
    qusdc = await QUSDC.deploy(merchant.address);
  });

  const newSalt = () => hexlify(randomBytes(32));

  describe('Native QIE — Standard', () => {
    it('creates → pays → marks Paid + forwards funds', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      const merchantBalBefore = await ethers.provider.getBalance(merchant.address);
      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });
      const merchantBalAfter = await ethers.provider.getBalance(merchant.address);
      expect(merchantBalAfter - merchantBalBefore).to.equal(amount);

      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Paid);
      expect(inv.payer).to.equal(payer.address);
      expect(inv.paidAmount).to.equal(amount);
    });

    it('rejects underpayment', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: parseEther('0.5') }))
        .to.be.revertedWithCustomError(qantara, 'AmountMismatch');
    });

    it('rejects double-pay', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });
      await expect(qantara.connect(other).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'WrongStatus');
    });

    it('rejects expired invoice', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      const block = await ethers.provider.getBlock('latest');
      const expiresAt = block!.timestamp + 60;
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, expiresAt, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await ethers.provider.send('evm_increaseTime', [120]);
      await ethers.provider.send('evm_mine', []);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'Expired');
    });
  });

  describe('Native QIE — Donation', () => {
    it('accepts any amount >= minimum', async () => {
      const salt = newSalt();
      const minimum = parseEther('0.1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, minimum, 0, ZeroHash, InvoiceType.Donation);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(payer).payInvoiceNative(hash, { value: parseEther('5') });
      const inv = await qantara.getInvoice(hash);
      expect(inv.paidAmount).to.equal(parseEther('5'));
    });

    it('rejects below minimum', async () => {
      const salt = newSalt();
      const minimum = parseEther('0.1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, minimum, 0, ZeroHash, InvoiceType.Donation);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: parseEther('0.05') }))
        .to.be.revertedWithCustomError(qantara, 'BelowMinimum');
    });
  });

  describe('ERC-20 (QUSDC)', () => {
    beforeEach(async () => {
      await qusdc.connect(merchant).mint(payer.address, parseUnits('1000', 6));
    });

    it('pays a Standard invoice via approve + payInvoiceERC20', async () => {
      const salt = newSalt();
      const amount = parseUnits('50', 6);
      await qantara.connect(merchant).createInvoice(salt, await qusdc.getAddress(), amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qusdc.connect(payer).approve(await qantara.getAddress(), amount);
      await qantara.connect(payer).payInvoiceERC20(hash, amount);

      expect(await qusdc.balanceOf(merchant.address)).to.equal(amount);
      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Paid);
    });

    it('rejects native call on ERC-20 invoice', async () => {
      const salt = newSalt();
      const amount = parseUnits('50', 6);
      await qantara.connect(merchant).createInvoice(salt, await qusdc.getAddress(), amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'UseDedicatedERC20Path');
    });
  });

  describe('Lifecycle: cancel / pause / resume', () => {
    it('merchant can cancel a Created invoice', async () => {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('1'), 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(merchant).cancelInvoice(hash);
      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Cancelled);
    });

    it('non-merchant cannot cancel', async () => {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('1'), 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(other).cancelInvoice(hash))
        .to.be.revertedWithCustomError(qantara, 'NotMerchant');
    });

    it('pause → cannot pay → resume → can pay', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(merchant).pauseInvoice(hash);
      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'WrongStatus');

      await qantara.connect(merchant).resumeInvoice(hash);
      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });
      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Paid);
    });
  });

  describe('Refund (pull-pattern)', () => {
    it('native: paid → refund credits payer → payer withdraws', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });

      await qantara.connect(merchant).refundInvoice(hash, { value: amount });

      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Refunded);
      expect(await qantara.refundBalances(payer.address, ZeroAddress)).to.equal(amount);

      const balBefore = await ethers.provider.getBalance(payer.address);
      const tx = await qantara.connect(payer).withdrawRefund(ZeroAddress);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await ethers.provider.getBalance(payer.address);
      expect(balAfter - balBefore + gasCost).to.equal(amount);
    });

    it('rejects refund of non-paid invoice', async () => {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('1'), 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await expect(qantara.connect(merchant).refundInvoice(hash, { value: parseEther('1') }))
        .to.be.revertedWithCustomError(qantara, 'WrongStatus');
    });
  });

  describe('Invariants', () => {
    it('cannot create duplicate invoice with same salt', async () => {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('1'), 0, ZeroHash, InvoiceType.Standard);
      await expect(qantara.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('2'), 0, ZeroHash, InvoiceType.Standard))
        .to.be.revertedWithCustomError(qantara, 'InvoiceExists');
    });

    it('rejects direct ETH transfer to contract', async () => {
      await expect(payer.sendTransaction({ to: await qantara.getAddress(), value: parseEther('1') }))
        .to.be.revertedWithCustomError(qantara, 'TransferFailed');
    });
  });
});
