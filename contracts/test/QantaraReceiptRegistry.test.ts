import { expect } from 'chai';
import { ethers } from 'hardhat';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { keccak256, toUtf8Bytes } from 'ethers';
import { QantaraReceiptRegistry } from '../typechain-types';

describe('QantaraReceiptRegistry', () => {
  let registry: QantaraReceiptRegistry;
  let owner: HardhatEthersSigner;
  let issuer: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const invoiceHash = () => keccak256(toUtf8Bytes(`invoice:${Date.now()}:${Math.random()}`));
  const receiptHash = () => keccak256(toUtf8Bytes(`receipt:${Date.now()}:${Math.random()}`));
  const txHash = () => keccak256(toUtf8Bytes(`tx:${Date.now()}:${Math.random()}`));

  beforeEach(async () => {
    [owner, issuer, merchant, payer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('QantaraReceiptRegistry');
    registry = await Factory.deploy(owner.address);
  });

  it('lets an authorized issuer anchor a verified receipt once', async () => {
    await registry.connect(owner).setIssuer(issuer.address, true);
    const inv = invoiceHash();
    const receipt = receiptHash();
    const paymentTx = txHash();
    const uri = 'ipfs://bafy-qantara-receipt';

    await expect(
      registry.connect(issuer).anchorReceipt(inv, receipt, paymentTx, merchant.address, payer.address, uri),
    )
      .to.emit(registry, 'ReceiptAnchored')
      .withArgs(receipt, inv, paymentTx, merchant.address, payer.address, issuer.address, anyValue, uri);

    expect(await registry.isAnchored(receipt)).to.equal(true);
    expect(await registry.receiptHashByInvoice(inv)).to.equal(receipt);

    const anchor = await registry.getReceiptAnchor(receipt);
    expect(anchor.invoiceHash).to.equal(inv);
    expect(anchor.receiptHash).to.equal(receipt);
    expect(anchor.paymentTxHash).to.equal(paymentTx);
    expect(anchor.merchant).to.equal(merchant.address);
    expect(anchor.payer).to.equal(payer.address);
    expect(anchor.issuer).to.equal(issuer.address);
    expect(anchor.uri).to.equal(uri);
  });

  it('rejects unauthorized issuers and revoked issuers', async () => {
    const inv = invoiceHash();
    const receipt = receiptHash();
    const paymentTx = txHash();

    await expect(
      registry.connect(other).anchorReceipt(inv, receipt, paymentTx, merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'NotIssuer');

    await registry.connect(owner).setIssuer(issuer.address, true);
    await registry.connect(owner).setIssuer(issuer.address, false);
    await expect(
      registry.connect(issuer).anchorReceipt(inv, receipt, paymentTx, merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'NotIssuer');
  });

  it('prevents duplicate receipt hashes and duplicate invoice anchors', async () => {
    await registry.connect(owner).setIssuer(issuer.address, true);
    const inv = invoiceHash();
    const receipt = receiptHash();
    const paymentTx = txHash();

    await registry.connect(issuer).anchorReceipt(inv, receipt, paymentTx, merchant.address, payer.address, '');

    await expect(
      registry.connect(issuer).anchorReceipt(invoiceHash(), receipt, txHash(), merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'ReceiptAlreadyAnchored');

    await expect(
      registry.connect(issuer).anchorReceipt(inv, receiptHash(), txHash(), merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'InvoiceAlreadyAnchored');
  });

  it('validates hashes, parties, URI size, and pause state', async () => {
    await registry.connect(owner).setIssuer(issuer.address, true);

    await expect(
      registry.connect(issuer).anchorReceipt(ethers.ZeroHash, receiptHash(), txHash(), merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'InvalidHash');

    await expect(
      registry.connect(issuer).anchorReceipt(invoiceHash(), receiptHash(), txHash(), ethers.ZeroAddress, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'InvalidParty');

    await expect(
      registry.connect(issuer).anchorReceipt(invoiceHash(), receiptHash(), txHash(), merchant.address, payer.address, 'x'.repeat(257)),
    ).to.be.revertedWithCustomError(registry, 'UriTooLarge');

    await registry.connect(owner).pause();
    await expect(
      registry.connect(issuer).anchorReceipt(invoiceHash(), receiptHash(), txHash(), merchant.address, payer.address, ''),
    ).to.be.revertedWithCustomError(registry, 'EnforcedPause');
  });
});
