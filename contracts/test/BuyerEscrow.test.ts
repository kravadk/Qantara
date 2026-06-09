import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, parseUnits, ZeroAddress, randomBytes, hexlify } from 'ethers';
import { BuyerEscrow, QUSDCTestToken } from '../typechain-types';

const Status = { Funded: 0, Released: 1, Refunded: 2 } as const;

describe('BuyerEscrow', () => {
  let esc: BuyerEscrow;
  let qusdc: QUSDCTestToken;
  let payer: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [payer, merchant, arbiter, stranger] = await ethers.getSigners();
    const E = await ethers.getContractFactory('BuyerEscrow');
    esc = await E.deploy(payer.address);
    const Q = await ethers.getContractFactory('QUSDCTestToken');
    qusdc = await Q.deploy(payer.address);
  });

  const newSalt = () => hexlify(randomBytes(32));
  const DAY = 86400;

  async function increase(seconds: number) {
    await ethers.provider.send('evm_increaseTime', [seconds]);
    await ethers.provider.send('evm_mine', []);
  }

  describe('Native QIE', () => {
    it('buyer funds → buyer confirms release → merchant paid', async () => {
      const salt = newSalt();
      const amt = parseEther('1');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, DAY, salt, { value: amt });
      const id = await esc.computeDealId(payer.address, merchant.address, salt);

      const before = await ethers.provider.getBalance(merchant.address);
      await expect(esc.connect(payer).confirmRelease(id)).to.emit(esc, 'DealReleased').withArgs(id, payer.address, amt);
      expect(await ethers.provider.getBalance(merchant.address)).to.equal(before + amt);
      expect((await esc.getDeal(id)).status).to.equal(Status.Released);
      expect(await ethers.provider.getBalance(await esc.getAddress())).to.equal(0n);
    });

    it('merchant graceful refund → buyer refunded', async () => {
      const salt = newSalt();
      const amt = parseEther('1');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, DAY, salt, { value: amt });
      const id = await esc.computeDealId(payer.address, merchant.address, salt);
      await expect(esc.connect(merchant).refund(id)).to.emit(esc, 'DealRefunded').withArgs(id, merchant.address, amt);
      expect((await esc.getDeal(id)).status).to.equal(Status.Refunded);
    });

    it('merchant can claim only after timeout', async () => {
      const salt = newSalt();
      const amt = parseEther('1');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, DAY, salt, { value: amt });
      const id = await esc.computeDealId(payer.address, merchant.address, salt);
      await expect(esc.connect(merchant).claimAfterTimeout(id)).to.be.revertedWithCustomError(esc, 'TooEarly');
      await increase(DAY + 1);
      await esc.connect(merchant).claimAfterTimeout(id);
      expect((await esc.getDeal(id)).status).to.equal(Status.Released);
    });

    it('no-timeout deal: merchant can never force-claim', async () => {
      const salt = newSalt();
      const amt = parseEther('1');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, 0, salt, { value: amt });
      const id = await esc.computeDealId(payer.address, merchant.address, salt);
      await increase(DAY * 30);
      await expect(esc.connect(merchant).claimAfterTimeout(id)).to.be.revertedWithCustomError(esc, 'TooEarly');
    });

    it('arbiter can release and refund', async () => {
      const s1 = newSalt(), s2 = newSalt();
      const amt = parseEther('1');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, arbiter.address, amt, DAY, s1, { value: amt });
      const id1 = await esc.computeDealId(payer.address, merchant.address, s1);
      await esc.connect(arbiter).confirmRelease(id1);
      expect((await esc.getDeal(id1)).status).to.equal(Status.Released);

      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, arbiter.address, amt, DAY, s2, { value: amt });
      const id2 = await esc.computeDealId(payer.address, merchant.address, s2);
      await esc.connect(arbiter).refund(id2);
      expect((await esc.getDeal(id2)).status).to.equal(Status.Refunded);
    });

    it('reverts: stranger release, wrong value, double release', async () => {
      const salt = newSalt();
      const amt = parseEther('1');
      await expect(esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, DAY, salt, { value: amt + 1n }))
        .to.be.revertedWithCustomError(esc, 'WrongValue');
      await esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, amt, DAY, salt, { value: amt });
      const id = await esc.computeDealId(payer.address, merchant.address, salt);
      await expect(esc.connect(stranger).confirmRelease(id)).to.be.revertedWithCustomError(esc, 'NotPayer');
      await esc.connect(payer).confirmRelease(id);
      await expect(esc.connect(payer).confirmRelease(id)).to.be.revertedWithCustomError(esc, 'WrongStatus');
    });
  });

  describe('ERC-20 QUSDC', () => {
    it('approve + fund + release', async () => {
      await qusdc.connect(payer).mint(payer.address, parseUnits('1000', 6));
      const salt = newSalt();
      const amt = parseUnits('50', 6);
      const qaddr = await qusdc.getAddress();
      await qusdc.connect(payer).approve(await esc.getAddress(), amt);
      await esc.connect(payer).createEscrow(merchant.address, qaddr, ZeroAddress, amt, DAY, salt);
      const id = await esc.computeDealId(payer.address, merchant.address, salt);
      await esc.connect(payer).confirmRelease(id);
      expect(await qusdc.balanceOf(merchant.address)).to.equal(amt);
    });
  });

  it('owner can pause; create reverts while paused', async () => {
    await esc.connect(payer).pause();
    await expect(esc.connect(payer).createEscrow(merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), DAY, newSalt(), { value: parseEther('1') }))
      .to.be.revertedWithCustomError(esc, 'EnforcedPause');
  });
});
