import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, randomBytes, hexlify, Signature, getBytes, keccak256, AbiCoder } from 'ethers';
import { Qantara, RecurringScheduler, BatchPayout, PermitToken, RevertingReceiver, AuthorizationToken } from '../typechain-types';

const InvoiceType = { Standard: 0, Donation: 1 } as const;
const newSalt = () => hexlify(randomBytes(32));
const HOUR = 3600;

describe('V3 features', () => {
  let owner: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, merchant, payer, relayer, recipient] = await ethers.getSigners();
  });

  describe('Qantara.payInvoiceERC20WithPermit (EIP-2612)', () => {
    let qantara: Qantara;
    let token: PermitToken;

    beforeEach(async () => {
      const Qantara = await ethers.getContractFactory('Qantara');
      qantara = await Qantara.deploy(owner.address);
      const PermitTokenFactory = await ethers.getContractFactory('PermitToken');
      token = await PermitTokenFactory.deploy();
      await token.transfer(payer.address, parseEther('100'));
    });

    it('pays an invoice with a single tx using permit signature', async () => {
      const salt = newSalt();
      const amount = parseEther('5');
      await qantara.connect(merchant).createInvoice(
        salt, await token.getAddress(), amount, 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      const latestBlock = await ethers.provider.getBlock('latest');
      const deadline = latestBlock!.timestamp + 3600;
      const nonce = await token.nonces(payer.address);
      const name = await token.name();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const domain = { name, version: '1', chainId, verifyingContract: await token.getAddress() };
      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const message = {
        owner: payer.address,
        spender: await qantara.getAddress(),
        value: amount,
        nonce,
        deadline,
      };
      const sig = await payer.signTypedData(domain, types, message);
      const { v, r, s } = Signature.from(sig);

      const balBefore = await token.balanceOf(merchant.address);
      await qantara.connect(payer).payInvoiceERC20WithPermit(hash, amount, deadline, v, r, s);
      expect(await token.balanceOf(merchant.address)).to.equal(balBefore + amount);

      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(1);
    });

    it('reverts if permit signature is invalid', async () => {
      const salt = newSalt();
      const amount = parseEther('5');
      await qantara.connect(merchant).createInvoice(
        salt, await token.getAddress(), amount, 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      const latestBlock = await ethers.provider.getBlock('latest');
      const deadline = latestBlock!.timestamp + 3600;
      const invalidR = '0x' + '11'.repeat(32);
      const invalidS = '0x' + '22'.repeat(32);
      await expect(
        qantara.connect(payer).payInvoiceERC20WithPermit(hash, amount, deadline, 27, invalidR, invalidS),
      ).to.be.reverted;
    });
  });

  describe('Qantara.payInvoiceERC20WithAuthorization (EIP-3009)', () => {
    let qantara: Qantara;
    let token: AuthorizationToken;

    beforeEach(async () => {
      const Qantara = await ethers.getContractFactory('Qantara');
      qantara = await Qantara.deploy(owner.address);
      const AuthToken = await ethers.getContractFactory('AuthorizationToken');
      token = await AuthToken.deploy();
      await token.transfer(payer.address, parseEther('100'));
    });

    it('pays an invoice with transferWithAuthorization', async () => {
      const salt = newSalt();
      const amount = parseEther('7');
      await qantara.connect(merchant).createInvoice(
        salt, await token.getAddress(), amount, 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      const latestBlock = await ethers.provider.getBlock('latest');
      const validAfter = 0;
      const validBefore = latestBlock!.timestamp + 3600;
      const nonce = hexlify(randomBytes(32));
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const domain = { name: await token.name(), version: '1', chainId, verifyingContract: await token.getAddress() };
      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      };
      const message = {
        from: payer.address,
        to: await qantara.getAddress(),
        value: amount,
        validAfter,
        validBefore,
        nonce,
      };
      const sig = await payer.signTypedData(domain, types, message);
      const { v, r, s } = Signature.from(sig);

      const balBefore = await token.balanceOf(merchant.address);
      await qantara.connect(payer).payInvoiceERC20WithAuthorization(hash, amount, validAfter, validBefore, nonce, v, r, s);
      expect(await token.balanceOf(merchant.address)).to.equal(balBefore + amount);

      const inv = await qantara.getInvoice(hash);
      expect(inv.status).to.equal(1);
      expect(inv.payer).to.equal(payer.address);
    });

    it('rejects replayed transfer authorizations', async () => {
      const salt = newSalt();
      const amount = parseEther('7');
      await qantara.connect(merchant).createInvoice(
        salt, await token.getAddress(), amount, 0,
        '0x' + '0'.repeat(64), InvoiceType.Standard,
      );
      const hash = await qantara.computeInvoiceHash(merchant.address, salt);

      const latestBlock = await ethers.provider.getBlock('latest');
      const validAfter = 0;
      const validBefore = latestBlock!.timestamp + 3600;
      const nonce = hexlify(randomBytes(32));
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const sig = Signature.from(await payer.signTypedData(
        { name: await token.name(), version: '1', chainId, verifyingContract: await token.getAddress() },
        {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        { from: payer.address, to: await qantara.getAddress(), value: amount, validAfter, validBefore, nonce },
      ));

      await qantara.connect(payer).payInvoiceERC20WithAuthorization(hash, amount, validAfter, validBefore, nonce, sig.v, sig.r, sig.s);
      await expect(
        qantara.connect(payer).payInvoiceERC20WithAuthorization(hash, amount, validAfter, validBefore, nonce, sig.v, sig.r, sig.s),
      ).to.be.reverted;
    });
  });

  describe('RecurringScheduler.cancel + withdrawPending (pull-fallback)', () => {
    let scheduler: RecurringScheduler;
    let revertingReceiver: RevertingReceiver;

    beforeEach(async () => {
      const S = await ethers.getContractFactory('RecurringScheduler');
      scheduler = await S.deploy(owner.address);
      const Rev = await ethers.getContractFactory('RevertingReceiver');
      revertingReceiver = await Rev.deploy();
    });

    it('cancel pushes funds to both parties on happy path (no regression)', async () => {
      const salt = newSalt();
      const amt = parseEther('0.1');
      await scheduler.connect(payer).createSubscription(
        merchant.address, ZeroAddress, amt, HOUR, 5, salt,
        { value: parseEther('0.5') },
      );
      const id = await scheduler.computeSubId(payer.address, merchant.address, salt);

      await ethers.provider.send('evm_increaseTime', [2 * HOUR + 1]);
      await ethers.provider.send('evm_mine', []);

      const merchStart = await ethers.provider.getBalance(merchant.address);
      await scheduler.connect(payer).cancel(id);
      const merchEnd = await ethers.provider.getBalance(merchant.address);
      expect(merchEnd - merchStart).to.equal(amt * 2n);
    });

    it('cancel credits pendingBalances when merchant push fails (DoS resistance)', async () => {
      const salt = newSalt();
      const amt = parseEther('0.1');
      const merchAddr = await revertingReceiver.getAddress();

      await scheduler.connect(payer).createSubscription(
        merchAddr, ZeroAddress, amt, HOUR, 5, salt,
        { value: parseEther('0.5') },
      );
      const id = await scheduler.computeSubId(payer.address, merchAddr, salt);

      await ethers.provider.send('evm_increaseTime', [2 * HOUR + 1]);
      await ethers.provider.send('evm_mine', []);

      const payerStart = await ethers.provider.getBalance(payer.address);
      const tx = await scheduler.connect(payer).cancel(id);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const payerEnd = await ethers.provider.getBalance(payer.address);
      expect(payerEnd - payerStart + gas).to.equal(amt * 3n);

      const pending = await scheduler.pendingBalances(merchAddr, ZeroAddress);
      expect(pending).to.equal(amt * 2n);
    });

    it('withdrawPending reverts for someone with no pending balance', async () => {
      await expect(scheduler.connect(relayer).withdrawPending(ZeroAddress))
        .to.be.revertedWithCustomError(scheduler, 'NothingPending');
    });
  });

  describe('BatchPayout.claimWithSignature (bearer link)', () => {
    let batch: BatchPayout;

    beforeEach(async () => {
      const B = await ethers.getContractFactory('BatchPayout');
      batch = await B.deploy(owner.address);
    });

    it('relayer can submit signed claim on behalf of recipient', async () => {
      const bearerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const pubKey20 = bearerWallet.address;
      const salt = newSalt();

      await batch.connect(payer).createBatch(
        ZeroAddress, [pubKey20], [parseEther('1')], 0, salt,
        { value: parseEther('1') },
      );
      const batchId = await batch.computeBatchId(payer.address, salt);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const messageHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'address', 'uint256', 'address'],
          [batchId, recipient.address, chainId, await batch.getAddress()],
        ),
      );
      const signature = await bearerWallet.signMessage(getBytes(messageHash));

      const recipBalStart = await ethers.provider.getBalance(recipient.address);
      const relayerBalStart = await ethers.provider.getBalance(relayer.address);
      const tx = await batch.connect(relayer).claimWithSignature(
        batchId, pubKey20, recipient.address, signature,
      );
      const r = await tx.wait();
      const relayerGas = r!.gasUsed * r!.gasPrice;

      const recipBalEnd = await ethers.provider.getBalance(recipient.address);
      const relayerBalEnd = await ethers.provider.getBalance(relayer.address);

      expect(recipBalEnd - recipBalStart).to.equal(parseEther('1'));
      expect(relayerBalStart - relayerBalEnd).to.equal(relayerGas);
    });

    it('rejects signature signed for a different recipient (MEV redirect defense)', async () => {
      const bearerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const pubKey20 = bearerWallet.address;
      const salt = newSalt();
      await batch.connect(payer).createBatch(
        ZeroAddress, [pubKey20], [parseEther('1')], 0, salt,
        { value: parseEther('1') },
      );
      const batchId = await batch.computeBatchId(payer.address, salt);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const messageHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'address', 'uint256', 'address'],
          [batchId, recipient.address, chainId, await batch.getAddress()],
        ),
      );
      const signature = await bearerWallet.signMessage(getBytes(messageHash));

      await expect(
        batch.connect(relayer).claimWithSignature(batchId, pubKey20, relayer.address, signature),
      ).to.be.revertedWithCustomError(batch, 'InvalidSignature');
    });

    it('rejects zero-address recipient', async () => {
      const bearerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const pubKey20 = bearerWallet.address;
      const salt = newSalt();
      await batch.connect(payer).createBatch(
        ZeroAddress, [pubKey20], [parseEther('1')], 0, salt,
        { value: parseEther('1') },
      );
      const batchId = await batch.computeBatchId(payer.address, salt);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const messageHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'address', 'uint256', 'address'],
          [batchId, ZeroAddress, chainId, await batch.getAddress()],
        ),
      );
      const signature = await bearerWallet.signMessage(getBytes(messageHash));
      await expect(
        batch.connect(relayer).claimWithSignature(batchId, pubKey20, ZeroAddress, signature),
      ).to.be.revertedWithCustomError(batch, 'NothingToClaim');
    });
  });
});
