import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, parseUnits, ZeroAddress, randomBytes, hexlify } from 'ethers';
import { InstallmentPlan, QUSDCTestToken } from '../typechain-types';

const Status = { Active: 0, Completed: 1, Cancelled: 2 } as const;

describe('InstallmentPlan', () => {
  let plan: InstallmentPlan;
  let qusdc: QUSDCTestToken;
  let payer: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [payer, merchant, stranger] = await ethers.getSigners();
    const P = await ethers.getContractFactory('InstallmentPlan');
    plan = await P.deploy(payer.address);
    const Q = await ethers.getContractFactory('QUSDCTestToken');
    qusdc = await Q.deploy(payer.address);
  });

  const newSalt = () => hexlify(randomBytes(32));
  const DAY = 86400;

  describe('Native QIE', () => {
    it('create → pay 3 → claim → pay remaining → claim → Completed', async () => {
      const salt = newSalt();
      const per = parseEther('1');
      await plan.connect(payer).createPlan(merchant.address, ZeroAddress, per, DAY, 5, salt);
      const id = await plan.computePlanId(payer.address, merchant.address, salt);

      await plan.connect(payer).payInstallments(id, 3, { value: per * 3n });
      let p = await plan.getPlan(id);
      expect(p.paidInstallments).to.equal(3);
      expect(p.status).to.equal(Status.Active);

      const before = await ethers.provider.getBalance(merchant.address);
      await plan.connect(merchant).claimInstallments(id); // merchant pays gas, but check contract balance instead
      expect(await ethers.provider.getBalance(await plan.getAddress())).to.equal(0n);
      p = await plan.getPlan(id);
      expect(p.claimedInstallments).to.equal(3);
      expect(await ethers.provider.getBalance(merchant.address)).to.be.greaterThan(before); // received ~3 QIE minus gas

      await plan.connect(payer).payInstallments(id, 2, { value: per * 2n });
      await plan.connect(merchant).claimInstallments(id);
      p = await plan.getPlan(id);
      expect(p.claimedInstallments).to.equal(5);
      expect(p.status).to.equal(Status.Completed);
    });

    it('payer cancels → refunds paid-but-unclaimed', async () => {
      const salt = newSalt();
      const per = parseEther('1');
      await plan.connect(payer).createPlan(merchant.address, ZeroAddress, per, DAY, 5, salt);
      const id = await plan.computePlanId(payer.address, merchant.address, salt);
      await plan.connect(payer).payInstallments(id, 2, { value: per * 2n });

      await expect(plan.connect(payer).cancelPlan(id))
        .to.emit(plan, 'PlanCancelled').withArgs(id, per * 2n);
      const p = await plan.getPlan(id);
      expect(p.status).to.equal(Status.Cancelled);
      expect(await ethers.provider.getBalance(await plan.getAddress())).to.equal(0n);
    });

    it('reverts: non-merchant claim, wrong value, overpay count, claim with nothing', async () => {
      const salt = newSalt();
      const per = parseEther('1');
      await plan.connect(payer).createPlan(merchant.address, ZeroAddress, per, DAY, 3, salt);
      const id = await plan.computePlanId(payer.address, merchant.address, salt);

      await expect(plan.connect(payer).payInstallments(id, 1, { value: per * 2n }))
        .to.be.revertedWithCustomError(plan, 'WrongValue');
      await expect(plan.connect(payer).payInstallments(id, 4, { value: per * 4n }))
        .to.be.revertedWithCustomError(plan, 'InvalidInstallmentCount');

      await plan.connect(payer).payInstallments(id, 1, { value: per });
      await expect(plan.connect(stranger).claimInstallments(id))
        .to.be.revertedWithCustomError(plan, 'NotMerchant');
      await plan.connect(merchant).claimInstallments(id);
      await expect(plan.connect(merchant).claimInstallments(id))
        .to.be.revertedWithCustomError(plan, 'NothingToClaim');
    });

    it('rejects bad create params', async () => {
      await expect(plan.connect(payer).createPlan(merchant.address, ZeroAddress, 999, DAY, 3, newSalt()))
        .to.be.revertedWithCustomError(plan, 'ZeroAmount');
      await expect(plan.connect(payer).createPlan(merchant.address, ZeroAddress, parseEther('1'), DAY, 0, newSalt()))
        .to.be.revertedWithCustomError(plan, 'ZeroInstallments');
      await expect(plan.connect(payer).createPlan(merchant.address, ZeroAddress, parseEther('1'), 0, 3, newSalt()))
        .to.be.revertedWithCustomError(plan, 'ZeroInterval');
    });
  });

  describe('ERC-20 QUSDC', () => {
    it('approve + pay + claim', async () => {
      await qusdc.connect(payer).mint(payer.address, parseUnits('1000', 6));
      const salt = newSalt();
      const per = parseUnits('10', 6);
      const qaddr = await qusdc.getAddress();

      await plan.connect(payer).createPlan(merchant.address, qaddr, per, DAY, 5, salt);
      const id = await plan.computePlanId(payer.address, merchant.address, salt);

      await qusdc.connect(payer).approve(await plan.getAddress(), per * 2n);
      await plan.connect(payer).payInstallments(id, 2);
      expect((await plan.getPlan(id)).paidInstallments).to.equal(2);

      await plan.connect(merchant).claimInstallments(id);
      expect(await qusdc.balanceOf(merchant.address)).to.equal(per * 2n);
    });

    it('rejects native value on ERC-20 plan', async () => {
      const salt = newSalt();
      const qaddr = await qusdc.getAddress();
      await plan.connect(payer).createPlan(merchant.address, qaddr, parseUnits('10', 6), DAY, 3, salt);
      const id = await plan.computePlanId(payer.address, merchant.address, salt);
      await expect(plan.connect(payer).payInstallments(id, 1, { value: 1n }))
        .to.be.revertedWithCustomError(plan, 'WrongValue');
    });
  });

  it('owner can pause; pay/claim revert while paused', async () => {
    const salt = newSalt();
    const per = parseEther('1');
    await plan.connect(payer).createPlan(merchant.address, ZeroAddress, per, DAY, 3, salt);
    const id = await plan.computePlanId(payer.address, merchant.address, salt);
    await plan.connect(payer).pause();
    await expect(plan.connect(payer).payInstallments(id, 1, { value: per }))
      .to.be.revertedWithCustomError(plan, 'EnforcedPause');
    await plan.connect(payer).unpause();
    await plan.connect(payer).payInstallments(id, 1, { value: per });
    expect((await plan.getPlan(id)).paidInstallments).to.equal(1);
  });
});
