// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title BatchPayout — pull-claim batched payouts
/// @notice Funder creates a batch of (recipient, amount) pairs in one funded tx.
///         Each recipient claims independently — pull-model avoids gas-DOS on push.
/// @dev Pausable kill-switch (Owner). FoT tokens rejected in createBatch.
contract BatchPayout is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;

    uint16 public constant MAX_RECIPIENTS = 100;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    struct Batch {
        address funder;
        address token;            // address(0) = native QIE
        uint256 totalAmount;
        uint256 claimedAmount;
        uint64 createdAt;
        uint64 expiresAt;         // 0 = never. After expiry, funder may reclaim leftovers.
        bool reclaimed;
    }

    mapping(bytes32 => Batch) public batches;
    /// @dev batchId => recipient => entitled amount (0 after claim)
    mapping(bytes32 => mapping(address => uint256)) public entitlements;

    event BatchCreated(
        bytes32 indexed batchId,
        address indexed funder,
        address indexed token,
        uint256 totalAmount,
        uint256 recipientCount,
        uint64 expiresAt
    );
    event BatchClaim(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event BatchReclaimed(bytes32 indexed batchId, address indexed funder, uint256 amount);

    error BatchExists();
    error BatchNotFound();
    error NotFunder();
    error TooManyRecipients();
    error LengthMismatch();
    error ZeroRecipients();
    error ZeroAmount();
    error AmountMismatch(uint256 expected, uint256 got);
    error NothingToClaim();
    error AlreadyReclaimed();
    error NotExpired();
    error TransferFailed();
    error FeeOnTransferNotSupported();
    error InvalidSignature();

    function computeBatchId(address funder, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(funder, salt, block.chainid, address(this)));
    }

    /// @notice Create and fund a batch. msg.sender == funder.
    ///         For native: send sum(amounts) as msg.value.
    ///         For ERC-20: pre-approve sum(amounts).
    ///         `expiresAt` is optional. After it passes the funder may reclaim unclaimed funds.
    function createBatch(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint64 expiresAt,
        bytes32 salt
    ) external payable nonReentrant whenNotPaused returns (bytes32 batchId) {
        if (recipients.length == 0) revert ZeroRecipients();
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();
        if (recipients.length != amounts.length) revert LengthMismatch();

        batchId = computeBatchId(msg.sender, salt);
        if (batches[batchId].funder != address(0)) revert BatchExists();

        uint256 total = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 a = amounts[i];
            if (a == 0) revert ZeroAmount();
            // Effects — entitle each recipient. Duplicate recipients accumulate.
            entitlements[batchId][recipients[i]] += a;
            total += a;
        }

        batches[batchId] = Batch({
            funder: msg.sender,
            token: token,
            totalAmount: total,
            claimedAmount: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            reclaimed: false
        });

        // Interactions
        if (token == address(0)) {
            if (msg.value != total) revert AmountMismatch(total, msg.value);
        } else {
            if (msg.value != 0) revert AmountMismatch(0, msg.value);
            // Fee-on-transfer guard
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), total);
            if (erc.balanceOf(address(this)) - before != total) revert FeeOnTransferNotSupported();
        }

        emit BatchCreated(batchId, msg.sender, token, total, recipients.length, expiresAt);
    }

    /// @notice Recipient pulls their entitlement.
    function claim(bytes32 batchId) external nonReentrant whenNotPaused {
        Batch storage b = batches[batchId];
        if (b.funder == address(0)) revert BatchNotFound();

        uint256 amount = entitlements[batchId][msg.sender];
        if (amount == 0) revert NothingToClaim();

        // Effects
        entitlements[batchId][msg.sender] = 0;
        b.claimedAmount += amount;

        // Interactions
        _payOut(b.token, msg.sender, amount);

        emit BatchClaim(batchId, msg.sender, amount);
    }

    /// @notice Bearer claim. Funder creates a batch where one of the
    ///         "recipient" addresses is actually the address derived from a fresh
    ///         secp256k1 keypair (we store only `pubKey20`). Anyone holding the private
    ///         key can sign `keccak256(batchId, recipient, chainid, address(this))` and
    ///         submit on behalf of `recipient`, who receives the funds.
    /// @dev    Binding the signed message to `recipient` (and not to `msg.sender`) defeats
    ///         MEV redirect: a mempool sniper can't reuse the sig to send funds elsewhere.
    ///         Enables gasless claims via relayer (anyone pays gas, only `recipient` receives).
    function claimWithSignature(
        bytes32 batchId,
        address pubKey20,
        address recipient,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        Batch storage b = batches[batchId];
        if (b.funder == address(0)) revert BatchNotFound();
        if (recipient == address(0)) revert NothingToClaim();

        uint256 amount = entitlements[batchId][pubKey20];
        if (amount == 0) revert NothingToClaim();

        // Verify signature over (batchId, recipient, chainid, contract) — replay-safe.
        bytes32 messageHash = keccak256(
            abi.encode(batchId, recipient, block.chainid, address(this))
        ).toEthSignedMessageHash();
        address signer = ECDSA.recover(messageHash, signature);
        if (signer != pubKey20) revert InvalidSignature();

        // Effects
        entitlements[batchId][pubKey20] = 0;
        b.claimedAmount += amount;

        // Interactions — funds go to RECIPIENT, not msg.sender, not pubKey20.
        _payOut(b.token, recipient, amount);

        emit BatchClaim(batchId, recipient, amount);
    }

    /// @notice Funder reclaims unclaimed balance after expiry. Single-shot.
    function reclaim(bytes32 batchId) external nonReentrant whenNotPaused {
        Batch storage b = batches[batchId];
        if (b.funder == address(0)) revert BatchNotFound();
        if (msg.sender != b.funder) revert NotFunder();
        if (b.reclaimed) revert AlreadyReclaimed();
        if (b.expiresAt == 0 || block.timestamp <= b.expiresAt) revert NotExpired();

        uint256 leftover = b.totalAmount - b.claimedAmount;
        if (leftover == 0) revert NothingToClaim();

        // Effects
        b.reclaimed = true;
        b.claimedAmount = b.totalAmount;

        // Interactions
        _payOut(b.token, b.funder, leftover);

        emit BatchReclaimed(batchId, b.funder, leftover);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function entitlementOf(bytes32 batchId, address recipient) external view returns (uint256) {
        return entitlements[batchId][recipient];
    }

    function _payOut(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable {
        revert TransferFailed();
    }
}
