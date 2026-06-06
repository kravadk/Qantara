import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { parseEther, ZeroAddress, hexlify, randomBytes } from 'ethers';
import { QantaraChat, QantaraSplits, QantaraSubscriptionV2, QantaraGasRelay } from '../../typechain-types';

const newSalt = () => hexlify(randomBytes(32));

describe('V4 — QantaraChat', () => {
  let owner: HardhatEthersSigner, alice: HardhatEthersSigner, bob: HardhatEthersSigner;
  let chat: QantaraChat;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const F = await ethers.getContractFactory('QantaraChat');
    chat = await F.deploy(owner.address);
  });

  it('derives the same conversationId regardless of pair order', async () => {
    const cAB = await chat.conversationIdFor(alice.address, bob.address);
    const cBA = await chat.conversationIdFor(bob.address, alice.address);
    expect(cAB).to.equal(cBA);
  });

  it('sends a message, emits Message, bumps counter', async () => {
    const cid = await chat.conversationIdFor(alice.address, bob.address);
    const cipher = '0xdeadbeef';
    const meta = '0x' + '11'.repeat(32);
    await expect(chat.connect(alice).sendMessage(bob.address, cipher, meta))
      .to.emit(chat, 'Message');
    expect(await chat.messageCount(cid)).to.equal(1n);
    expect(await chat.lastMessageAt(cid)).to.be.gt(0n);
  });

  it('reverts on self-message, empty body, oversize body, zero recipient', async () => {
    await expect(chat.connect(alice).sendMessage(alice.address, '0x01', '0x' + '0'.repeat(64)))
      .to.be.revertedWithCustomError(chat, 'CannotMessageSelf');
    await expect(chat.connect(alice).sendMessage(bob.address, '0x', '0x' + '0'.repeat(64)))
      .to.be.revertedWithCustomError(chat, 'EmptyBody');
    const huge = '0x' + '00'.repeat(2049);
    await expect(chat.connect(alice).sendMessage(bob.address, huge, '0x' + '0'.repeat(64)))
      .to.be.revertedWithCustomError(chat, 'BodyTooLarge');
    await expect(chat.connect(alice).sendMessage(ZeroAddress, '0x01', '0x' + '0'.repeat(64)))
      .to.be.revertedWithCustomError(chat, 'InvalidRecipient');
  });

  it('respects pause / unpause', async () => {
    await chat.connect(owner).pause();
    await expect(chat.connect(alice).sendMessage(bob.address, '0x01', '0x' + '0'.repeat(64)))
      .to.be.revertedWithCustomError(chat, 'EnforcedPause');
    await chat.connect(owner).unpause();
    await expect(chat.connect(alice).sendMessage(bob.address, '0x01', '0x' + '0'.repeat(64)))
      .to.emit(chat, 'Message');
  });
});

describe('V4 — QantaraSplits', () => {
  let owner: HardhatEthersSigner, alice: HardhatEthersSigner, bob: HardhatEthersSigner, carol: HardhatEthersSigner;
  let splits: QantaraSplits;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const F = await ethers.getContractFactory('QantaraSplits');
    splits = await F.deploy(owner.address);
  });

  it('creates a split and rejects bad shapes', async () => {
    const salt = newSalt();
    await splits.connect(alice).createSplit(
      [bob.address, carol.address],
      [6000, 4000],
      alice.address,
      salt,
    );
    const id = await splits.computeSplitId([bob.address, carol.address], [6000, 4000], salt);
    const got = await splits.getSplit(id);
    expect(got.controller).to.equal(alice.address);

    await expect(
      splits.connect(alice).createSplit([bob.address], [9000], alice.address, newSalt()),
    ).to.be.revertedWithCustomError(splits, 'SharesSumMismatch');

    await expect(
      splits.connect(alice).createSplit([bob.address, carol.address], [5000], alice.address, newSalt()),
    ).to.be.revertedWithCustomError(splits, 'InvalidShares');
  });

  it('distributes native QIE pro-rata + dust to last', async () => {
    const salt = newSalt();
    await splits.connect(alice).createSplit(
      [bob.address, carol.address],
      [6000, 4000],
      alice.address,
      salt,
    );
    const id = await splits.computeSplitId([bob.address, carol.address], [6000, 4000], salt);

    const balB0 = await ethers.provider.getBalance(bob.address);
    const balC0 = await ethers.provider.getBalance(carol.address);
    await splits.connect(alice).distributeNative(id, { value: parseEther('1') });
    const balB1 = await ethers.provider.getBalance(bob.address);
    const balC1 = await ethers.provider.getBalance(carol.address);

    expect(balB1 - balB0).to.equal(parseEther('0.6'));
    expect(balC1 - balC0).to.equal(parseEther('0.4'));
  });

  it('updates split (controller-only) and blocks for immutable / non-controller', async () => {
    const salt = newSalt();
    await splits.connect(alice).createSplit([bob.address, carol.address], [5000, 5000], alice.address, salt);
    const id = await splits.computeSplitId([bob.address, carol.address], [5000, 5000], salt);

    await splits.connect(alice).updateSplit(id, [bob.address, carol.address], [7000, 3000]);
    expect((await splits.getSplit(id)).sharesBps[0]).to.equal(7000n);

    await expect(
      splits.connect(bob).updateSplit(id, [bob.address, carol.address], [1000, 9000]),
    ).to.be.revertedWithCustomError(splits, 'NotController');

    const salt2 = newSalt();
    await splits.connect(alice).createSplit([bob.address, carol.address], [5000, 5000], ZeroAddress, salt2);
    const id2 = await splits.computeSplitId([bob.address, carol.address], [5000, 5000], salt2);
    await expect(
      splits.connect(alice).updateSplit(id2, [bob.address, carol.address], [1000, 9000]),
    ).to.be.revertedWithCustomError(splits, 'ImmutableSplit');
  });
});

describe('V4 — QantaraSubscriptionV2 (streaming)', () => {
  let owner: HardhatEthersSigner, payer: HardhatEthersSigner, recipient: HardhatEthersSigner;
  let stream: QantaraSubscriptionV2;

  beforeEach(async () => {
    [owner, payer, recipient] = await ethers.getSigners();
    const F = await ethers.getContractFactory('QantaraSubscriptionV2');
    stream = await F.deploy(owner.address);
  });

  it('creates a stream and progressively pays the recipient', async () => {
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    const startsAt = now + 1;
    const endsAt = startsAt + 100;
    const rate = parseEther('0.01');
    const total = rate * 100n;

    await stream.connect(payer).createStream(recipient.address, ZeroAddress, rate, startsAt, endsAt, { value: total });
    const id = 1n;

    await ethers.provider.send('evm_increaseTime', [60]);
    await ethers.provider.send('evm_mine', []);

    const withdrawable = await stream.withdrawable(id);
    expect(withdrawable).to.be.gt(parseEther('0.5'));

    const balBefore = await ethers.provider.getBalance(recipient.address);
    await stream.connect(recipient).withdraw(id);
    const balAfter = await ethers.provider.getBalance(recipient.address);
    expect(balAfter).to.be.gt(balBefore);

    await ethers.provider.send('evm_increaseTime', [200]);
    await ethers.provider.send('evm_mine', []);
    await stream.connect(recipient).withdraw(id);
    const finalBal = await ethers.provider.getBalance(recipient.address);
    expect(finalBal - balBefore).to.be.closeTo(total, parseEther('0.01'));
  });

  it('cancel splits funds: recipient keeps accrued, payer refunded remainder', async () => {
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    const startsAt = now + 1;
    const endsAt = startsAt + 100;
    const rate = parseEther('0.01');
    const total = rate * 100n;
    await stream.connect(payer).createStream(recipient.address, ZeroAddress, rate, startsAt, endsAt, { value: total });
    const id = 1n;

    await ethers.provider.send('evm_increaseTime', [30]);
    await ethers.provider.send('evm_mine', []);

    await expect(stream.connect(payer).cancel(id)).to.emit(stream, 'StreamCancelled');
    await expect(stream.connect(payer).cancel(id)).to.be.revertedWithCustomError(stream, 'AlreadyCancelled');
  });

  it('rejects wrong value, invalid window, and self-stream', async () => {
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    await expect(
      stream.connect(payer).createStream(recipient.address, ZeroAddress, parseEther('0.01'), now, now, { value: 0 }),
    ).to.be.revertedWithCustomError(stream, 'InvalidWindow');
    await expect(
      stream.connect(payer).createStream(payer.address, ZeroAddress, parseEther('0.01'), now + 1, now + 100, { value: parseEther('1') }),
    ).to.be.revertedWithCustomError(stream, 'InvalidWindow');
    await expect(
      stream.connect(payer).createStream(recipient.address, ZeroAddress, parseEther('0.01'), now + 1, now + 100, { value: parseEther('0.5') }),
    ).to.be.revertedWithCustomError(stream, 'WrongValue');
  });
});

describe('V4 — QantaraGasRelay (EIP-712)', () => {
  let owner: HardhatEthersSigner, payer: HardhatEthersSigner;
  let relay: QantaraGasRelay;
  let chat: QantaraChat;

  beforeEach(async () => {
    [owner, payer] = await ethers.getSigners();
    const RF = await ethers.getContractFactory('QantaraGasRelay');
    relay = await RF.deploy(owner.address);
    const CF = await ethers.getContractFactory('QantaraChat');
    chat = await CF.deploy(owner.address);
  });

  it('verifies an EIP-712 ForwardRequest signature', async () => {
    const chatAddr = await chat.getAddress();
    const relayAddr = await relay.getAddress();

    const sendSelector = chat.interface.getFunction('sendMessage')!.selector as `0x${string}`;
    await relay.connect(owner).setSelectorAllowed(chatAddr, sendSelector, true);

    const innerData = chat.interface.encodeFunctionData('sendMessage', [
      owner.address,
      '0xdead',
      '0x' + '0'.repeat(64),
    ]);

    const req = {
      from: payer.address,
      to: chatAddr,
      value: 0n,
      gas: 500_000n,
      nonce: 0n,
      deadline: (2n ** 64n) - 1n,
      data: innerData as `0x${string}`,
    };

    const domain = {
      name: 'QantaraGasRelay',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: relayAddr,
    };
    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
        { name: 'data', type: 'bytes' },
      ],
    };
    const sig = await payer.signTypedData(domain, types, req);
    expect(await relay.verify(req, sig)).to.equal(true);
  });

  it('rejects unknown selectors', async () => {
    const chatAddr = await chat.getAddress();
    const relayAddr = await relay.getAddress();

    const innerData = chat.interface.encodeFunctionData('sendMessage', [
      owner.address,
      '0xdead',
      '0x' + '0'.repeat(64),
    ]);
    const req = {
      from: payer.address,
      to: chatAddr,
      value: 0n,
      gas: 500_000n,
      nonce: 0n,
      deadline: (2n ** 64n) - 1n,
      data: innerData as `0x${string}`,
    };
    const domain = {
      name: 'QantaraGasRelay',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: relayAddr,
    };
    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
        { name: 'data', type: 'bytes' },
      ],
    };
    const sig = await payer.signTypedData(domain, types, req);
    await expect(relay.connect(owner).execute(req, sig)).to.be.revertedWithCustomError(relay, 'SelectorNotAllowed');
  });
});
