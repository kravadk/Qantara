import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { toUtf8Bytes, hexlify, ZeroAddress, ZeroHash, getAddress } from 'ethers';
import { QantaraChat2771 } from '../typechain-types';

/**
 * QantaraChat2771 — ERC-2771 forwarder-aware chat.
 * Verifies the core property the gas relay needs: a message sent THROUGH the
 * trusted forwarder is attributed to the appended author, not to the forwarder.
 */
describe('QantaraChat2771', () => {
  let chat: QantaraChat2771;
  let owner: HardhatEthersSigner;
  let forwarder: HardhatEthersSigner; // stands in for QantaraGasRelay
  let alice: HardhatEthersSigner;     // the real author (would sign the ForwardRequest)
  let bob: HardhatEthersSigner;       // recipient
  let stranger: HardhatEthersSigner;  // untrusted caller

  beforeEach(async () => {
    [owner, forwarder, alice, bob, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory('QantaraChat2771');
    chat = await F.deploy(forwarder.address, owner.address);
  });

  const body = (s: string) => hexlify(toUtf8Bytes(s));

  // Encode sendMessage(to, ciphertext, meta) and append `author` (20 bytes) like the relay does.
  function forwardedData(to: string, ciphertext: string, author: string): string {
    const data = chat.interface.encodeFunctionData('sendMessage', [to, ciphertext, ZeroHash]);
    return data + author.slice(2).toLowerCase(); // append 20-byte author, no 0x
  }

  async function lastMessageFrom(txPromise: Promise<any>): Promise<string> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    const parsed = receipt.logs
      .map((l: any) => {
        try { return chat.interface.parseLog(l); } catch { return null; }
      })
      .find((p: any) => p && p.name === 'Message');
    if (!parsed) throw new Error('no Message event');
    return getAddress(parsed.args.from);
  }

  it('direct (self-paid) call attributes the message to msg.sender', async () => {
    const from = await lastMessageFrom(chat.connect(alice).sendMessage(bob.address, body('hi direct'), ZeroHash));
    expect(from).to.equal(alice.address);
  });

  it('forwarded call by trusted forwarder attributes to the appended author (alice), NOT the forwarder', async () => {
    const from = await lastMessageFrom(
      forwarder.sendTransaction({ to: await chat.getAddress(), data: forwardedData(bob.address, body('gasless hi'), alice.address) }),
    );
    expect(from).to.equal(alice.address);
    expect(from).to.not.equal(forwarder.address);
  });

  it('appended author is ignored when caller is NOT the trusted forwarder', async () => {
    // stranger appends alice's address but is not the trusted forwarder → _msgSender == stranger
    const from = await lastMessageFrom(
      stranger.sendTransaction({ to: await chat.getAddress(), data: forwardedData(bob.address, body('spoof'), alice.address) }),
    );
    expect(from).to.equal(stranger.address);
  });

  it('conversation id is symmetric and message count increments', async () => {
    const cid = await chat.conversationIdFor(alice.address, bob.address);
    expect(await chat.conversationIdFor(bob.address, alice.address)).to.equal(cid);
    expect(await chat.messageCount(cid)).to.equal(0n);
    await chat.connect(alice).sendMessage(bob.address, body('1'), ZeroHash);
    await forwarder.sendTransaction({ to: await chat.getAddress(), data: forwardedData(alice.address, body('2'), bob.address) });
    expect(await chat.messageCount(cid)).to.equal(2n);
    expect(await chat.lastMessageAt(cid)).to.be.greaterThan(0n);
  });

  it('reverts: empty body / self / zero recipient (forwarded author respected)', async () => {
    await expect(chat.connect(alice).sendMessage(bob.address, '0x', ZeroHash)).to.be.revertedWithCustomError(chat, 'EmptyBody');
    await expect(chat.connect(alice).sendMessage(alice.address, body('x'), ZeroHash)).to.be.revertedWithCustomError(chat, 'CannotMessageSelf');
    await expect(chat.connect(alice).sendMessage(ZeroAddress, body('x'), ZeroHash)).to.be.revertedWithCustomError(chat, 'InvalidRecipient');
    // forwarded self-message: author=alice, to=alice → CannotMessageSelf
    await expect(
      forwarder.sendTransaction({ to: await chat.getAddress(), data: forwardedData(alice.address, body('x'), alice.address) }),
    ).to.be.reverted;
  });

  it('owner can pause; sends revert while paused', async () => {
    await chat.connect(owner).pause();
    await expect(chat.connect(alice).sendMessage(bob.address, body('x'), ZeroHash)).to.be.revertedWithCustomError(chat, 'EnforcedPause');
    await chat.connect(owner).unpause();
    const from = await lastMessageFrom(chat.connect(alice).sendMessage(bob.address, body('ok'), ZeroHash));
    expect(from).to.equal(alice.address);
  });

  it('exposes the trusted forwarder', async () => {
    expect(await chat.trustedForwarder()).to.equal(forwarder.address);
    expect(await chat.isTrustedForwarder(forwarder.address)).to.equal(true);
    expect(await chat.isTrustedForwarder(stranger.address)).to.equal(false);
  });
});
