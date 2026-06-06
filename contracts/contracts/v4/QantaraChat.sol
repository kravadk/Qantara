// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QantaraChat — on-chain message log between two parties.
/// @notice Each message costs gas to send (~50-80k). Bold UX statement:
///         real chat between wallet holders is real on-chain settlement.
///         Ciphertext is opaque bytes; clients are expected to encrypt with a
///         shared ECDH-derived key. The contract NEVER inspects message bodies.
///
/// @dev Conversation ID is the keccak256 of the sorted address pair, so any
///      two parties (a, b) share a single deterministic thread regardless of
///      who initiated. messageCount per conversation lets clients paginate
///      cheaply using cursors.
contract QantaraChat is Pausable, Ownable {
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

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Compute the deterministic conversation id for any pair (a, b).
    function conversationIdFor(address a, address b) public pure returns (bytes32) {
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(lo, hi));
    }

    /// @notice Send an opaque ciphertext message to `to`.
    function sendMessage(
        address to,
        bytes calldata ciphertext,
        bytes32 metadataHash
    ) external whenNotPaused returns (uint64 id) {
        if (to == address(0)) revert InvalidRecipient();
        if (to == msg.sender) revert CannotMessageSelf();
        uint256 len = ciphertext.length;
        if (len == 0) revert EmptyBody();
        if (len > MAX_BODY_BYTES) revert BodyTooLarge(len);

        bytes32 cid = conversationIdFor(msg.sender, to);
        unchecked { id = ++messageCount[cid]; }
        lastMessageAt[cid] = uint64(block.timestamp);

        emit Message(cid, id, msg.sender, to, ciphertext, metadataHash, uint64(block.timestamp));
    }
}
