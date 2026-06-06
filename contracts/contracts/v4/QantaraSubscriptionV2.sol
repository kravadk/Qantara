// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QantaraSubscriptionV2 — per-second linear token streams.
contract QantaraSubscriptionV2 is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    struct Stream {
        address payer;
        address recipient;
        address token;          // address(0) = native QIE
        uint256 amountPerSec;   // wei per second
        uint64  startsAt;
        uint64  endsAt;
        uint256 deposited;      // initial total
        uint256 withdrawn;      // by recipient so far
        bool    cancelled;
    }

    uint256 public nextStreamId;
    mapping(uint256 => Stream) public streams;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 amountPerSec,
        uint64 startsAt,
        uint64 endsAt,
        uint256 deposited
    );
    event StreamWithdrawn(uint256 indexed streamId, address indexed recipient, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, uint256 refundToPayer, uint256 payoutToRecipient);

    error InvalidWindow();
    error InvalidRate();
    error UnknownStream();
    error NotPayer();
    error NotRecipient();
    error AlreadyCancelled();
    error NothingToWithdraw();
    error FeeOnTransferNotSupported();
    error WrongValue(uint256 expected, uint256 got);
    error TransferFailed();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function createStream(
        address recipient,
        address token,
        uint256 amountPerSec,
        uint64  startsAt,
        uint64  endsAt
    ) external payable nonReentrant whenNotPaused returns (uint256 streamId) {
        if (recipient == address(0) || recipient == msg.sender) revert InvalidWindow();
        if (endsAt <= startsAt) revert InvalidWindow();
        if (amountPerSec == 0) revert InvalidRate();
        uint256 deposit = amountPerSec * uint256(endsAt - startsAt);

        if (token == address(0)) {
            if (msg.value != deposit) revert WrongValue(deposit, msg.value);
        } else {
            if (msg.value != 0) revert WrongValue(0, msg.value);
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), deposit);
            if (erc.balanceOf(address(this)) - before != deposit) revert FeeOnTransferNotSupported();
        }

        unchecked { streamId = ++nextStreamId; }
        streams[streamId] = Stream({
            payer:        msg.sender,
            recipient:    recipient,
            token:        token,
            amountPerSec: amountPerSec,
            startsAt:     startsAt,
            endsAt:       endsAt,
            deposited:    deposit,
            withdrawn:    0,
            cancelled:    false
        });
        emit StreamCreated(streamId, msg.sender, recipient, token, amountPerSec, startsAt, endsAt, deposit);
    }

    function streamedSoFar(uint256 streamId) public view returns (uint256) {
        Stream storage s = streams[streamId];
        if (s.payer == address(0)) revert UnknownStream();
        if (block.timestamp <= s.startsAt) return 0;
        uint64 t = uint64(block.timestamp);
        if (t > s.endsAt) t = s.endsAt;
        return s.amountPerSec * uint256(t - s.startsAt);
    }

    function withdrawable(uint256 streamId) public view returns (uint256) {
        Stream storage s = streams[streamId];
        if (s.payer == address(0)) revert UnknownStream();
        uint256 accrued = streamedSoFar(streamId);
        if (accrued <= s.withdrawn) return 0;
        return accrued - s.withdrawn;
    }

    function withdraw(uint256 streamId) external nonReentrant whenNotPaused {
        Stream storage s = streams[streamId];
        if (s.payer == address(0)) revert UnknownStream();
        if (msg.sender != s.recipient) revert NotRecipient();
        uint256 amount = withdrawable(streamId);
        if (amount == 0) revert NothingToWithdraw();
        s.withdrawn += amount;
        _payout(s.token, s.recipient, amount);
        emit StreamWithdrawn(streamId, s.recipient, amount);
    }

    /// @notice Cancel a stream. Recipient keeps everything streamed so far;
    ///         payer reclaims the unstreamed remainder.
    function cancel(uint256 streamId) external nonReentrant whenNotPaused {
        Stream storage s = streams[streamId];
        if (s.payer == address(0)) revert UnknownStream();
        if (msg.sender != s.payer) revert NotPayer();
        if (s.cancelled) revert AlreadyCancelled();

        uint256 accrued = streamedSoFar(streamId);
        uint256 owedToRecipient = accrued > s.withdrawn ? accrued - s.withdrawn : 0;
        uint256 refundPayer = s.deposited - (s.withdrawn + owedToRecipient);

        s.cancelled = true;
        s.withdrawn += owedToRecipient;

        if (owedToRecipient > 0) _payout(s.token, s.recipient, owedToRecipient);
        if (refundPayer > 0)     _payout(s.token, s.payer, refundPayer);

        emit StreamCancelled(streamId, refundPayer, owedToRecipient);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable { revert TransferFailed(); }
}
