import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, randomBytes, hexlify } from 'ethers';
import { BatchPayout } from '../typechain-types';

async function advance(seconds: number) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
}

describe('BatchPayout', () => {
  let batch: BatchPayout;
  let funder: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [funder, alice, bob, carol, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory('BatchPayout');
    batch = await F.deploy(funder.address);
  });

  const newSalt = () => hexlify(randomBytes(32));

  describe('Native QIE', () => {
    it('create + multiple recipients claim independently', async () => {
      const salt = newSalt();
      const recipients = [alice.address, bob.address, carol.address];
      const amounts = [parseEther('1'), parseEther('2'), parseEther('3')];
      await batch.connect(funder).createBatch(ZeroAddress, recipients, amounts, 0, salt, { value: parseEther('6') });
      const id = await batch.computeBatchId(funder.address, salt);

      expect(await batch.entitlementOf(id, alice.address)).to.equal(parseEther('1'));
      expect(await batch.entitlementOf(id, bob.address)).to.equal(parseEther('2'));

      const aliceStart = await ethers.provider.getBalance(alice.address);
      const tx = await batch.connect(alice).claim(id);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const aliceEnd = await ethers.provider.getBalance(alice.address);
      expect(aliceEnd - aliceStart + gas).to.equal(parseEther('1'));
      expect(await batch.entitlementOf(id, alice.address)).to.equal(0n);
      expect(await batch.entitlementOf(id, bob.address)).to.equal(parseEther('2'));

      const b = await batch.getBatch(id);
      expect(b.claimedAmount).to.equal(parseEther('1'));
    });

    it('rejects double-claim', async () => {
      const salt = newSalt();
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], 0, salt, { value: parseEther('1') });
      const id = await batch.computeBatchId(funder.address, salt);
      await batch.connect(alice).claim(id);
      await expect(batch.connect(alice).claim(id)).to.be.revertedWithCustomError(batch, 'NothingToClaim');
    });

    it('rejects msg.value mismatch', async () => {
      const salt = newSalt();
      await expect(
        batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], 0, salt, { value: parseEther('0.5') }),
      ).to.be.revertedWithCustomError(batch, 'AmountMismatch');
    });

    it('rejects length mismatch', async () => {
      const salt = newSalt();
      await expect(
        batch.connect(funder).createBatch(ZeroAddress, [alice.address, bob.address], [parseEther('1')], 0, salt, { value: parseEther('1') }),
      ).to.be.revertedWithCustomError(batch, 'LengthMismatch');
    });

    it('rejects > 100 recipients', async () => {
      const recipients = Array(101).fill(alice.address);
      const amounts = Array(101).fill(1n);
      await expect(
        batch.connect(funder).createBatch(ZeroAddress, recipients, amounts, 0, newSalt(), { value: 101n }),
      ).to.be.revertedWithCustomError(batch, 'TooManyRecipients');
    });

    it('non-recipient claim → NothingToClaim', async () => {
      const salt = newSalt();
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], 0, salt, { value: parseEther('1') });
      const id = await batch.computeBatchId(funder.address, salt);
      await expect(batch.connect(stranger).claim(id)).to.be.revertedWithCustomError(batch, 'NothingToClaim');
    });

    it('duplicate recipient entries accumulate', async () => {
      const salt = newSalt();
      await batch.connect(funder).createBatch(
        ZeroAddress,
        [alice.address, alice.address],
        [parseEther('1'), parseEther('2')],
        0,
        salt,
        { value: parseEther('3') },
      );
      const id = await batch.computeBatchId(funder.address, salt);
      expect(await batch.entitlementOf(id, alice.address)).to.equal(parseEther('3'));
    });
  });

  describe('Reclaim', () => {
    it('funder reclaims unclaimed after expiry', async () => {
      const salt = newSalt();
      const block = await ethers.provider.getBlock('latest');
      const expiresAt = block!.timestamp + 100;
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address, bob.address], [parseEther('1'), parseEther('2')], expiresAt, salt, { value: parseEther('3') });
      const id = await batch.computeBatchId(funder.address, salt);

      await batch.connect(alice).claim(id);
      await advance(200);

      const balBefore = await ethers.provider.getBalance(funder.address);
      const tx = await batch.connect(funder).reclaim(id);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const balAfter = await ethers.provider.getBalance(funder.address);
      expect(balAfter - balBefore + gas).to.equal(parseEther('2'));
    });

    it('rejects reclaim before expiry', async () => {
      const salt = newSalt();
      const block = await ethers.provider.getBlock('latest');
      const expiresAt = block!.timestamp + 1_000_000;
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], expiresAt, salt, { value: parseEther('1') });
      const id = await batch.computeBatchId(funder.address, salt);
      await expect(batch.connect(funder).reclaim(id)).to.be.revertedWithCustomError(batch, 'NotExpired');
    });

    it('rejects reclaim when expiresAt = 0 (never expires)', async () => {
      const salt = newSalt();
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], 0, salt, { value: parseEther('1') });
      const id = await batch.computeBatchId(funder.address, salt);
      await expect(batch.connect(funder).reclaim(id)).to.be.revertedWithCustomError(batch, 'NotExpired');
    });

    it('non-funder cannot reclaim', async () => {
      const salt = newSalt();
      const block = await ethers.provider.getBlock('latest');
      const expiresAt = block!.timestamp + 10;
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], expiresAt, salt, { value: parseEther('1') });
      const id = await batch.computeBatchId(funder.address, salt);
      await advance(50);
      await expect(batch.connect(stranger).reclaim(id)).to.be.revertedWithCustomError(batch, 'NotFunder');
    });
  });

  describe('Invariants', () => {
    it('duplicate salt → revert', async () => {
      const salt = newSalt();
      await batch.connect(funder).createBatch(ZeroAddress, [alice.address], [parseEther('1')], 0, salt, { value: parseEther('1') });
      await expect(
        batch.connect(funder).createBatch(ZeroAddress, [bob.address], [parseEther('1')], 0, salt, { value: parseEther('1') }),
      ).to.be.revertedWithCustomError(batch, 'BatchExists');
    });

    it('rejects zero amount in entries', async () => {
      const salt = newSalt();
      await expect(
        batch.connect(funder).createBatch(ZeroAddress, [alice.address, bob.address], [parseEther('1'), 0n], 0, salt, { value: parseEther('1') }),
      ).to.be.revertedWithCustomError(batch, 'ZeroAmount');
    });

    it('rejects direct ETH transfer', async () => {
      await expect(funder.sendTransaction({ to: await batch.getAddress(), value: parseEther('1') })).to.be.revertedWithCustomError(batch, 'TransferFailed');
    });
  });
});
