import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, randomBytes, hexlify } from 'ethers';
import {
  Qantara,
  QantaraMultiPay,
  MilestoneEscrow,
  BatchPayout,
  RecurringScheduler,
  FeeOnTransferToken,
  RevertingReceiver,
} from '../typechain-types';

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const newSalt = () => hexlify(randomBytes(32));

describe('Adversarial: security guards', () => {
  let owner: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  let qantara: Qantara;
  let multipay: QantaraMultiPay;
  let escrow: MilestoneEscrow;
  let batch: BatchPayout;
  let scheduler: RecurringScheduler;
  let fotToken: FeeOnTransferToken;
  let revertingReceiver: RevertingReceiver;

  beforeEach(async () => {
    [owner, attacker, merchant, payer, recipient] = await ethers.getSigners();

    const Qantara = await ethers.getContractFactory('Qantara');
    qantara = await Qantara.deploy(owner.address);

    const MultiPay = await ethers.getContractFactory('QantaraMultiPay');
    multipay = await MultiPay.deploy(owner.address);

    const Escrow = await ethers.getContractFactory('MilestoneEscrow');
    escrow = await Escrow.deploy(owner.address);

    const Batch = await ethers.getContractFactory('BatchPayout');
    batch = await Batch.deploy(owner.address);

    const Scheduler = await ethers.getContractFactory('RecurringScheduler');
    scheduler = await Scheduler.deploy(owner.address);

    const FOT = await ethers.getContractFactory('FeeOnTransferToken');
    fotToken = await FOT.deploy();

    const Receiver = await ethers.getContractFactory('RevertingReceiver');
    revertingReceiver = await Receiver.deploy();
  });

  describe('Fee-on-transfer token rejection', () => {
    it('Qantara.payInvoiceERC20 rejects FoT token', async () => {
      await fotToken.transfer(payer.address, parseEther('100'));

      const salt = newSalt();
      const amount = parseEther('1');
      await qantara.connect(merchant).createInvoice(
        salt, await fotToken.getAddress(), amount, 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await fotToken.connect(payer).approve(await qantara.getAddress(), parseEther('2'));

      await expect(qantara.connect(payer).payInvoiceERC20(hash, amount))
        .to.be.revertedWithCustomError(qantara, 'FeeOnTransferNotSupported');
    });

    it('QantaraMultiPay.contributeERC20 rejects FoT token', async () => {
      await fotToken.transfer(payer.address, parseEther('100'));

      const salt = newSalt();
      await multipay.connect(merchant).createInvoice(
        salt, await fotToken.getAddress(), 0, 0, '0x' + '0'.repeat(64),
      );
      const hash = await multipay.computeInvoiceHash(merchant.address, salt);

      await fotToken.connect(payer).approve(await multipay.getAddress(), parseEther('2'));
      await expect(multipay.connect(payer).contributeERC20(hash, parseEther('1')))
        .to.be.revertedWithCustomError(multipay, 'FeeOnTransferNotSupported');
    });

    it('MilestoneEscrow.createEscrow rejects FoT token', async () => {
      await fotToken.transfer(payer.address, parseEther('100'));
      await fotToken.connect(payer).approve(await escrow.getAddress(), parseEther('10'));

      await expect(
        escrow.connect(payer).createEscrow(
          merchant.address, await fotToken.getAddress(), ZeroAddress,
          parseEther('5'), newSalt(),
        ),
      ).to.be.revertedWithCustomError(escrow, 'FeeOnTransferNotSupported');
    });

    it('BatchPayout.createBatch rejects FoT token', async () => {
      await fotToken.transfer(payer.address, parseEther('100'));
      await fotToken.connect(payer).approve(await batch.getAddress(), parseEther('10'));

      await expect(
        batch.connect(payer).createBatch(
          await fotToken.getAddress(),
          [recipient.address],
          [parseEther('1')],
          0,
          newSalt(),
        ),
      ).to.be.revertedWithCustomError(batch, 'FeeOnTransferNotSupported');
    });

    it('RecurringScheduler.createSubscription rejects FoT token', async () => {
      await fotToken.transfer(payer.address, parseEther('100'));
      await fotToken.connect(payer).approve(await scheduler.getAddress(), parseEther('10'));

      await expect(
        scheduler.connect(payer).createSubscription(
          merchant.address, await fotToken.getAddress(),
          parseEther('1'), 3600, 5, newSalt(),
        ),
      ).to.be.revertedWithCustomError(scheduler, 'FeeOnTransferNotSupported');
    });
  });

  describe('Minimum amount guards', () => {
    it('Qantara.createInvoice rejects amount < MIN_AMOUNT (1000 wei)', async () => {
      await expect(
        qantara.connect(merchant).createInvoice(
          newSalt(), ZeroAddress, 999, 0,
          '0x' + '0'.repeat(64), InvoiceType.Standard,
        ),
      ).to.be.revertedWithCustomError(qantara, 'BelowMinimum');
    });

    it('MilestoneEscrow.createEscrow rejects amount < MIN_AMOUNT', async () => {
      await expect(
        escrow.connect(payer).createEscrow(
          merchant.address, ZeroAddress, ZeroAddress, 999, newSalt(),
          { value: 999 },
        ),
      ).to.be.revertedWithCustomError(escrow, 'ZeroAmount');
    });

    it('RecurringScheduler.createSubscription rejects amountPerPeriod < 1000', async () => {
      await expect(
        scheduler.connect(payer).createSubscription(
          merchant.address, ZeroAddress, 999, 3600, 5, newSalt(),
          { value: 4995 },
        ),
      ).to.be.revertedWithCustomError(scheduler, 'ZeroAmount');
    });
  });

  describe('Pausable kill-switch', () => {
    it('non-owner cannot pause Qantara', async () => {
      await expect(qantara.connect(attacker).pause())
        .to.be.revertedWithCustomError(qantara, 'OwnableUnauthorizedAccount');
    });

    it('paused Qantara blocks createInvoice', async () => {
      await qantara.connect(owner).pause();
      await expect(
        qantara.connect(merchant).createInvoice(
          newSalt(), ZeroAddress, parseEther('1'), 0,
          '0x' + '0'.repeat(64), InvoiceType.Standard,
        ),
      ).to.be.revertedWithCustomError(qantara, 'EnforcedPause');
    });

    it('paused Qantara allows view (getInvoice) — read still works', async () => {
      const salt = newSalt();
      await qantara.connect(merchant).createInvoice(
        salt, ZeroAddress, parseEther('1'), 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      await qantara.connect(owner).pause();
      const inv = await qantara.getInvoice(hash);
      expect(inv.merchant).to.equal(merchant.address);
    });

    it('owner can pause + unpause + create resumes', async () => {
      await qantara.connect(owner).pause();
      await qantara.connect(owner).unpause();
      await qantara.connect(merchant).createInvoice(
        newSalt(), ZeroAddress, parseEther('1'), 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
    });

    it('paused MultiPay blocks contributeNative', async () => {
      const salt = newSalt();
      await multipay.connect(merchant).createInvoice(salt, ZeroAddress, 0, 0, '0x' + '0'.repeat(64));
      const hash = await multipay.computeInvoiceHash(merchant.address, salt);

      await multipay.connect(owner).pause();
      await expect(multipay.connect(payer).contributeNative(hash, { value: parseEther('1') }))
        .to.be.revertedWithCustomError(multipay, 'EnforcedPause');
    });

    it('paused BatchPayout blocks claim', async () => {
      const salt = newSalt();
      await batch.connect(payer).createBatch(
        ZeroAddress, [recipient.address], [parseEther('1')], 0, salt,
        { value: parseEther('1') },
      );
      const id = await batch.computeBatchId(payer.address, salt);

      await batch.connect(owner).pause();
      await expect(batch.connect(recipient).claim(id))
        .to.be.revertedWithCustomError(batch, 'EnforcedPause');
    });

    it('paused MilestoneEscrow blocks createEscrow', async () => {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(payer).createEscrow(
          merchant.address, ZeroAddress, ZeroAddress, parseEther('1'), newSalt(),
          { value: parseEther('1') },
        ),
      ).to.be.revertedWithCustomError(escrow, 'EnforcedPause');
    });

    it('paused RecurringScheduler blocks createSubscription', async () => {
      await scheduler.connect(owner).pause();
      await expect(
        scheduler.connect(payer).createSubscription(
          merchant.address, ZeroAddress, parseEther('1'), 3600, 5, newSalt(),
          { value: parseEther('5') },
        ),
      ).to.be.revertedWithCustomError(scheduler, 'EnforcedPause');
    });
  });

  describe('Push-pattern DoS resistance', () => {
    it('Qantara.payInvoiceNative reverts when merchant is reverting contract', async () => {
      const salt = newSalt();
      const amount = parseEther('1');
      const merchantAddr = await revertingReceiver.getAddress();

      const iface = qantara.interface;
      const calldata = iface.encodeFunctionData('createInvoice', [
        salt, ZeroAddress, amount, 0, '0x' + '0'.repeat(64), InvoiceType.Standard,
      ]);
      await revertingReceiver.callAny(await qantara.getAddress(), calldata);

      const hash = await qantara.computeInvoiceHash(merchantAddr, salt);
      await expect(qantara.connect(payer).payInvoiceNative(hash, { value: amount }))
        .to.be.revertedWithCustomError(qantara, 'TransferFailed');
    });

    it('BatchPayout: one reverting recipient does not block other recipients', async () => {
      const salt = newSalt();
      const revAddr = await revertingReceiver.getAddress();
      const total = parseEther('3');
      await batch.connect(payer).createBatch(
        ZeroAddress,
        [revAddr, recipient.address],
        [parseEther('1'), parseEther('2')],
        0, salt,
        { value: total },
      );
      const id = await batch.computeBatchId(payer.address, salt);

      const ifaceB = batch.interface;
      const claimCalldata = ifaceB.encodeFunctionData('claim', [id]);
      await expect(revertingReceiver.callAny(await batch.getAddress(), claimCalldata))
        .to.be.reverted;

      const balBefore = await ethers.provider.getBalance(recipient.address);
      const tx = await batch.connect(recipient).claim(id);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const balAfter = await ethers.provider.getBalance(recipient.address);
      expect(balAfter - balBefore + gas).to.equal(parseEther('2'));
    });
  });
});
