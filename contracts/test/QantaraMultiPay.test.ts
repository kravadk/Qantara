import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, ZeroHash, randomBytes, hexlify } from 'ethers';
import { QantaraMultiPay } from '../typechain-types';

const Status = { Open: 0, Settled: 1, Cancelled: 2 } as const;

describe('QantaraMultiPay', () => {
  let mp: QantaraMultiPay;
  let merchant: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [merchant, alice, bob, other] = await ethers.getSigners();
    const MP = await ethers.getContractFactory('QantaraMultiPay');
    mp = await MP.deploy(merchant.address);
  });

  const newSalt = () => hexlify(randomBytes(32));

  it('multiple payers contribute → merchant settles → receives full pool', async () => {
    const salt = newSalt();
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, parseEther('5'), 0, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);

    await mp.connect(alice).contributeNative(hash, { value: parseEther('2') });
    await mp.connect(bob).contributeNative(hash, { value: parseEther('3') });

    expect((await mp.getInvoice(hash)).totalRaised).to.equal(parseEther('5'));
    expect(await mp.getContribution(hash, alice.address)).to.equal(parseEther('2'));

    const merchantBalBefore = await ethers.provider.getBalance(merchant.address);
    const tx = await mp.connect(merchant).settleInvoice(hash);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const merchantBalAfter = await ethers.provider.getBalance(merchant.address);
    expect(merchantBalAfter - merchantBalBefore + gasCost).to.equal(parseEther('5'));

    expect((await mp.getInvoice(hash)).status).to.equal(Status.Settled);
  });

  it('cancel → payers claim refunds via withdraw (pull pattern, no loop)', async () => {
    const salt = newSalt();
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, 0, 0, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);

    await mp.connect(alice).contributeNative(hash, { value: parseEther('1') });
    await mp.connect(bob).contributeNative(hash, { value: parseEther('2') });
    await mp.connect(merchant).cancelInvoice(hash);

    await mp.connect(alice).claimRefund(hash);
    expect(await mp.refundBalances(alice.address, ZeroAddress)).to.equal(parseEther('1'));

    const balBefore = await ethers.provider.getBalance(alice.address);
    const tx = await mp.connect(alice).withdrawRefund(ZeroAddress);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    expect((await ethers.provider.getBalance(alice.address)) - balBefore + gas).to.equal(parseEther('1'));

    expect(await mp.refundBalances(bob.address, ZeroAddress)).to.equal(0);
    await mp.connect(bob).claimRefund(hash);
    expect(await mp.refundBalances(bob.address, ZeroAddress)).to.equal(parseEther('2'));
  });

  it('rejects contribution to cancelled invoice', async () => {
    const salt = newSalt();
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, 0, 0, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);

    await mp.connect(merchant).cancelInvoice(hash);
    await expect(mp.connect(alice).contributeNative(hash, { value: parseEther('1') }))
      .to.be.revertedWithCustomError(mp, 'WrongStatus');
  });

  it('non-merchant cannot settle or cancel', async () => {
    const salt = newSalt();
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, 0, 0, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);
    await mp.connect(alice).contributeNative(hash, { value: parseEther('1') });

    await expect(mp.connect(other).settleInvoice(hash))
      .to.be.revertedWithCustomError(mp, 'NotMerchant');
    await expect(mp.connect(other).cancelInvoice(hash))
      .to.be.revertedWithCustomError(mp, 'NotMerchant');
  });

  it('rejects claimRefund for payer who did not contribute', async () => {
    const salt = newSalt();
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, 0, 0, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);
    await mp.connect(alice).contributeNative(hash, { value: parseEther('1') });
    await mp.connect(merchant).cancelInvoice(hash);

    await expect(mp.connect(other).claimRefund(hash))
      .to.be.revertedWithCustomError(mp, 'NoContribution');
  });

  it('expired open invoice allows claimRefund', async () => {
    const salt = newSalt();
    const block = await ethers.provider.getBlock('latest');
    const expiresAt = block!.timestamp + 60;
    await mp.connect(merchant).createInvoice(salt, ZeroAddress, 0, expiresAt, ZeroHash);
    const hash = await mp.computeInvoiceHash(merchant.address, salt);

    await mp.connect(alice).contributeNative(hash, { value: parseEther('1') });
    await ethers.provider.send('evm_increaseTime', [120]);
    await ethers.provider.send('evm_mine', []);

    await mp.connect(alice).claimRefund(hash);
    expect(await mp.refundBalances(alice.address, ZeroAddress)).to.equal(parseEther('1'));
  });
});
