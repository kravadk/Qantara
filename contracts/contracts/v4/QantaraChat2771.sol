// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @title QantaraChat2771 — gasless on-chain message log between two parties.
/// @notice Functionally identical to QantaraChat, but ERC-2771 forwarder-aware:
///         when called through the trusted forwarder (QantaraGasRelay), the real
///         author is recovered from the 20 bytes the relay appends to calldata,
///         so a message is attributed to the PAYER who signed it — not to the
///         relay/relayer that paid the gas. This is what makes gasless chat
///         correct rather than decorative.
///
/// @dev The original QantaraChat reads `msg.sender` directly and therefore cannot
///      be sponsored: a forwarded message would be recorded as sent by the relay.
///      Here every author check goes through `_msgSender()` (overridden by
///      ERC2771Context). Direct (self-paid) calls keep working unchanged because
///      `_msgSender()` falls back to `msg.sender` when the caller is not the
///      trusted forwarder.
contract QantaraChat2771 is ERC2771Context, Pausable, Ownable {
    /// @notice Maximum bytes per message body. Prevents griefing via huge calldata.
    uint256 public constant MAX_BODY_BYTES = 2048;

    /// @notice Per-conversation monotonic message counter, used as message id.
    mapping(bytes32 => uint64) public messageCount;

    /// @notice Lightweight last-message pointer for cheap "unread" UX.
    mapping(bytes32 => uint64) public lastMessageAt;

    event Message(
        bytes32 indexed conversationId,
        uint64  indexed id,
        address indexed from,
        address to,
        bytes   ciphertext,
        bytes32 metadataHash,
        uint64  timestamp
    );

    error EmptyBody();
    error BodyTooLarge(uint256 size);
    error CannotMessageSelf();
    error InvalidRecipient();

    /// @param trustedForwarder_ the QantaraGasRelay address allowed to sponsor calls.
    /// @param initialOwner      the contract owner (pause control).
    constructor(address trustedForwarder_, address initialOwner)
        ERC2771Context(trustedForwarder_)
        Ownable(initialOwner)
    {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Compute the deterministic conversation id for any pair (a, b).
    function conversationIdFor(address a, address b) public pure returns (bytes32) {
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(lo, hi));
    }

    /// @notice Send an opaque ciphertext message to `to`.
    /// @dev Author is `_msgSender()`: the signer recovered from the forwarder when
    ///      sponsored, or the direct caller otherwise.
    function sendMessage(
        address to,
        bytes calldata ciphertext,
        bytes32 metadataHash
    ) external whenNotPaused returns (uint64 id) {
        address sender = _msgSender();
        if (to == address(0)) revert InvalidRecipient();
        if (to == sender) revert CannotMessageSelf();
        uint256 len = ciphertext.length;
        if (len == 0) revert EmptyBody();
        if (len > MAX_BODY_BYTES) revert BodyTooLarge(len);

        bytes32 cid = conversationIdFor(sender, to);
        unchecked { id = ++messageCount[cid]; }
        lastMessageAt[cid] = uint64(block.timestamp);

        emit Message(cid, id, sender, to, ciphertext, metadataHash, uint64(block.timestamp));
    }

    // ── ERC2771Context / Context multiple-inheritance overrides ──────────────

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
