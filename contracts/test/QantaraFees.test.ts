import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, parseUnits, ZeroAddress, ZeroHash, randomBytes, hexlify } from 'ethers';
import { QantaraFees, QUSDCTestToken } from '../typechain-types';

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const Status = { Created: 0, Paid: 1, Cancelled: 2, Refunded: 3, Paused: 4 } as const;

describe('QantaraFees', () => {
  let qantara: QantaraFees;
  let qusdc: QUSDCTestToken;
  let owner: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;

  const FEE_BPS = 250; // 2.5%

  const newSalt = () => hexlify(randomBytes(32));

  beforeEach(async () => {
    [owner, merchant, payer, feeRecipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('QantaraFees');
    qantara = await Factory.deploy(owner.address, FEE_BPS, feeRecipient.address);
    const QUSDC = await ethers.getContractFactory('QUSDCTestToken');
    qusdc = await QUSDC.deploy(merchant.address);
  });

  async function createNative(amount: bigint) {
    const salt = newSalt();
    await qantara.connect(merchant).createInvoice(salt, ZeroAddress, amount, 0, ZeroHash, InvoiceType.Standard);
    return qantara.computeInvoiceHash(merchant.address, salt);
  }

  describe('fee configuration', () => {
    it('exposes the configured fee and quotes it', async () => {
      expect(await qantara.feeBps()).to.equal(FEE_BPS);
      expect(await qantara.feeRecipient()).to.equal(feeRecipient.address);
      expect(await qantara.quoteFee(parseEther('1'))).to.equal(parseEther('1') * BigInt(FEE_BPS) / 10_000n);
    });

    it('caps the fee at MAX_FEE_BPS and is owner-only', async () => {
      await expect(qantara.connect(owner).setFeeConfig(1001, feeRecipient.address))
        .to.be.revertedWithCustomError(qantara, 'FeeTooHigh');
      await expect(qantara.connect(merchant).setFeeConfig(100, feeRecipient.address))
        .to.be.revertedWithCustomError(qantara, 'OwnableUnauthorizedAccount');
      await expect(qantara.connect(owner).setFeeConfig(500, feeRecipient.address))
        .to.emit(qantara, 'FeeConfigUpdated').withArgs(500, feeRecipient.address);
      expect(await qantara.feeBps()).to.equal(500);
    });
  });

  describe('native QIE payments', () => {
    it('splits the fee to the recipient and the remainder to the merchant', async () => {
      const amount = parseEther('1');
      const hash = await createNative(amount);
      const fee = amount * BigInt(FEE_BPS) / 10_000n;

      const merchantBefore = await ethers.provider.getBalance(merchant.address);
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);

      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount }))
        .to.emit(qantara, 'FeeCollected').withArgs(hash, ZeroAddress, feeRecipient.address, fee);

      expect(await ethers.provider.getBalance(merchant.address) - merchantBefore).to.equal(amount - fee);
      expect(await ethers.provider.getBalance(feeRecipient.address) - feeBefore).to.equal(fee);

      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(Status.Paid);
      expect(inv.paidAmount).to.equal(amount);
    });

    it('forwards the full amount when the fee is disabled (feeBps = 0)', async () => {
      await qantara.connect(owner).setFeeConfig(0, feeRecipient.address);
      const amount = parseEther('1');
      const hash = await createNative(amount);

      const merchantBefore = await ethers.provider.getBalance(merchant.address);
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);

      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });

      expect(await ethers.provider.getBalance(merchant.address) - merchantBefore).to.equal(amount);
      expect(await ethers.provider.getBalance(feeRecipient.address) - feeBefore).to.equal(0n);
    });
  });

  describe('ERC-20 payments', () => {
    beforeEach(async () => {
      await qusdc.connect(merchant).mint(payer.address, parseUnits('1000', 6));
    });

    it('splits the fee to the recipient and the remainder to the merchant', async () => {
      const amount = parseUnits('100', 6);
      const fee = amount * BigInt(FEE_BPS) / 10_000n;
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(salt, await qusdc.getAddress(), amount, 0, ZeroHash, InvoiceType.Standard);
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qusdc.connect(payer).approve(await qantara.getAddress(), amount);
      await expect(qantara.connect(payer).payInvoiceERC20(hash, amount))
        .to.emit(qantara, 'FeeCollected').withArgs(hash, await qusdc.getAddress(), feeRecipient.address, fee);

      expect(await qusdc.balanceOf(merchant.address)).to.equal(amount - fee);
      expect(await qusdc.balanceOf(feeRecipient.address)).to.equal(fee);
      expect(await qusdc.balanceOf(await qantara.getAddress())).to.equal(0n);
    });
  });

  describe('refunds', () => {
    it('credits the payer the principal the merchant received (minus fee)', async () => {
      const amount = parseEther('1');
      const fee = amount * BigInt(FEE_BPS) / 10_000n;
      const principal = amount - fee;
      const hash = await createNative(amount);
      await qantara.connect(payer).payInvoiceNative(hash, { value: amount });

      await expect(qantara.connect(merchant).refundInvoice(hash, { value: principal }))
        .to.emit(qantara, 'RefundCredited').withArgs(payer.address, ZeroAddress, principal);

      expect(await qantara.refundBalances(payer.address, ZeroAddress)).to.equal(principal);

      const payerBefore = await ethers.provider.getBalance(payer.address);
      const tx = await qantara.connect(payer).withdrawRefund(ZeroAddress);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      expect(await ethers.provider.getBalance(payer.address) - payerBefore).to.equal(principal - gas);
    });
  });
});
