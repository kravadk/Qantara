import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, parseUnits, ZeroAddress, randomBytes, hexlify } from 'ethers';
import { MilestoneEscrow, QUSDCTestToken } from '../typechain-types';

const Status = { Active: 0, Completed: 1, Refunded: 2 } as const;

describe('MilestoneEscrow', () => {
  let escrow: MilestoneEscrow;
  let qusdc: QUSDCTestToken;
  let payer: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [payer, merchant, arbiter, stranger] = await ethers.getSigners();
    const E = await ethers.getContractFactory('MilestoneEscrow');
    escrow = await E.deploy(payer.address);
    const Q = await ethers.getContractFactory('QUSDCTestToken');
    qusdc = await Q.deploy(payer.address);
  });

  const newSalt = () => hexlify(randomBytes(32));

  describe('Native QIE', () => {
    it('create → 4 milestone claims = full payout', async () => {
      const salt = newSalt();
      const total = parseEther('1');
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, total, salt, { value: total });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);

      const merchantStart = await ethers.provider.getBalance(merchant.address);
      let gasSpent = 0n;
      for (let i = 0; i < 4; i++) {
        const tx = await escrow.connect(merchant).claimMilestone(id);
        const r = await tx.wait();
        gasSpent += r!.gasUsed * r!.gasPrice;
      }
      const merchantEnd = await ethers.provider.getBalance(merchant.address);
      expect(merchantEnd - merchantStart + gasSpent).to.equal(total);

      const e = await escrow.getEscrow(id);
      expect(e.status).to.equal(Status.Completed);
      expect(e.nextTier).to.equal(4);
    });

    it('rejects 5th claim', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      for (let i = 0; i < 4; i++) await escrow.connect(merchant).claimMilestone(id);
      await expect(escrow.connect(merchant).claimMilestone(id)).to.be.revertedWithCustomError(escrow, 'WrongStatus');
    });

    it('rejects msg.value mismatch', async () => {
      const salt = newSalt();
      await expect(
        escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('0.5') }),
      ).to.be.revertedWithCustomError(escrow, 'AmountMismatch');
    });

    it('non-merchant cannot claim', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      await expect(escrow.connect(stranger).claimMilestone(id)).to.be.revertedWithCustomError(escrow, 'NotMerchant');
    });

    it('previewNextMilestone returns correct tier + amount', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('4'), salt, { value: parseEther('4') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      let [tier, amt] = await escrow.previewNextMilestone(id);
      expect(tier).to.equal(0);
      expect(amt).to.equal(parseEther('1'));
      await escrow.connect(merchant).claimMilestone(id);
      [tier, amt] = await escrow.previewNextMilestone(id);
      expect(tier).to.equal(1);
      expect(amt).to.equal(parseEther('1'));
    });
  });

  describe('ERC-20 QUSDC', () => {
    it('create → claim cycle works with safeTransferFrom + safeTransfer', async () => {
      await qusdc.connect(payer).mint(payer.address, parseUnits('1000', 6));
      const salt = newSalt();
      const total = parseUnits('100', 6);
      await qusdc.connect(payer).approve(await escrow.getAddress(), total);
      await escrow.connect(payer).createEscrow(merchant.address, await qusdc.getAddress(), ZeroAddress, total, salt);
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);

      await escrow.connect(merchant).claimMilestone(id);
      expect(await qusdc.balanceOf(merchant.address)).to.equal(parseUnits('25', 6));

      await escrow.connect(merchant).claimMilestone(id);
      expect(await qusdc.balanceOf(merchant.address)).to.equal(parseUnits('50', 6));
    });

    it('rejects native msg.value on ERC-20 escrow', async () => {
      const salt = newSalt();
      await expect(
        escrow.connect(payer).createEscrow(merchant.address, await qusdc.getAddress(), ZeroAddress, parseUnits('10', 6), salt, { value: parseEther('1') }),
      ).to.be.revertedWithCustomError(escrow, 'AmountMismatch');
    });
  });

  describe('Refund', () => {
    it('arbiter can refund remainder after partial claims', async () => {
      const salt = newSalt();
      const total = parseEther('4');
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, arbiter.address, total, salt, { value: total });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      await escrow.connect(merchant).claimMilestone(id);
      await escrow.connect(merchant).claimMilestone(id);

      const payerStart = await ethers.provider.getBalance(payer.address);
      await escrow.connect(arbiter).refundRemainder(id);
      const payerEnd = await ethers.provider.getBalance(payer.address);
      expect(payerEnd - payerStart).to.equal(parseEther('2'));

      const e = await escrow.getEscrow(id);
      expect(e.status).to.equal(Status.Refunded);
    });

    it('merchant can release remainder back to payer (graceful exit)', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      await escrow.connect(merchant).refundRemainder(id);
      const e = await escrow.getEscrow(id);
      expect(e.status).to.equal(Status.Refunded);
    });

    it('stranger cannot refund', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, arbiter.address, parseEther('1'), salt, { value: parseEther('1') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      await expect(escrow.connect(stranger).refundRemainder(id)).to.be.revertedWithCustomError(escrow, 'NotAuthorisedToRefund');
    });

    it('payer alone cannot refund themselves (funds are protected for merchant)', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') });
      const id = await escrow.computeEscrowId(payer.address, merchant.address, salt);
      await expect(escrow.connect(payer).refundRemainder(id)).to.be.revertedWithCustomError(escrow, 'NotAuthorisedToRefund');
    });
  });

  describe('Invariants', () => {
    it('duplicate salt → revert', async () => {
      const salt = newSalt();
      await escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') });
      await expect(
        escrow.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), salt, { value: parseEther('1') }),
      ).to.be.revertedWithCustomError(escrow, 'EscrowExists');
    });

    it('rejects direct ETH transfer', async () => {
      await expect(payer.sendTransaction({ to: await escrow.getAddress(), value: parseEther('1') })).to.be.revertedWithCustomError(escrow, 'TransferFailed');
    });
  });
});
