// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MilestoneEscrow — pre-funded escrow with sequential milestone release
/// @notice Payer deposits full amount up-front. Merchant claims through 4 tiers (25/50/75/100%)
///         in order. Optional arbiter (address(0) = disabled) can refund pending balance to payer.
/// @dev Pausable kill-switch (Owner). FoT tokens rejected in createEscrow. Refund is push-pattern
///      because escrowed funds belong unambiguously to one payer — DoS surface is single-victim,
///      and the merchant/arbiter can always re-call refundRemainder if payer fixes their receiver.
contract MilestoneEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_AMOUNT = 1000;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    enum Status { Active, Completed, Refunded }

    struct Escrow {
        address payer;
        address merchant;
        address token;        // address(0) = native QIE
        address arbiter;      // address(0) = no dispute resolution
        uint256 totalAmount;
        uint256 claimedAmount;
        uint8 nextTier;       // 0..3, becomes 4 when fully claimed
        uint64 createdAt;
        Status status;
    }

    /// @dev Milestone cumulative shares in basis points (2500, 5000, 7500, 10000).
    function _tierBps(uint8 tier) private pure returns (uint16) {
        if (tier == 0) return 2500;
        if (tier == 1) return 5000;
        if (tier == 2) return 7500;
        return 10000;
    }

    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed payer,
        address indexed merchant,
        address token,
        address arbiter,
        uint256 totalAmount
    );
    event MilestoneClaimed(bytes32 indexed escrowId, uint8 tier, uint256 amount, uint256 cumulativeClaimed);
    event EscrowCompleted(bytes32 indexed escrowId, uint256 totalClaimed);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed by, uint256 amount);

    error EscrowExists();
    error EscrowNotFound();
    error NotMerchant();
    error NotAuthorisedToRefund();
    error WrongStatus(Status current);
    error AllTiersClaimed();
    error AmountMismatch(uint256 expected, uint256 got);
    error TransferFailed();
    error ZeroAmount();
    error FeeOnTransferNotSupported();

    /// @notice Deterministic escrow id — UI can pre-compute before mining.
    function computeEscrowId(address payer, address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(payer, merchant, salt, block.chainid, address(this)));
    }

    /// @notice Open and fund an escrow. msg.sender == payer.
    ///         For native: send `totalAmount` as msg.value.
    ///         For ERC-20: pre-approve the contract for `totalAmount`.
    function createEscrow(
        address merchant,
        address token,
        address arbiter,
        uint256 totalAmount,
        bytes32 salt
    ) external payable nonReentrant whenNotPaused returns (bytes32 escrowId) {
        if (totalAmount < MIN_AMOUNT) revert ZeroAmount();
        escrowId = computeEscrowId(msg.sender, merchant, salt);
        if (escrows[escrowId].payer != address(0)) revert EscrowExists();

        // Effects
        escrows[escrowId] = Escrow({
            payer: msg.sender,
            merchant: merchant,
            token: token,
            arbiter: arbiter,
            totalAmount: totalAmount,
            claimedAmount: 0,
            nextTier: 0,
            createdAt: uint64(block.timestamp),
            status: Status.Active
        });

        // Interactions
        if (token == address(0)) {
            if (msg.value != totalAmount) revert AmountMismatch(totalAmount, msg.value);
        } else {
            if (msg.value != 0) revert AmountMismatch(0, msg.value);
            // Fee-on-transfer guard
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), totalAmount);
            if (erc.balanceOf(address(this)) - before != totalAmount) revert FeeOnTransferNotSupported();
        }

        emit EscrowCreated(escrowId, msg.sender, merchant, token, arbiter, totalAmount);
    }

    /// @notice Merchant claims the next milestone.
    function claimMilestone(bytes32 escrowId) external nonReentrant whenNotPaused {
        Escrow storage e = escrows[escrowId];
        if (e.payer == address(0)) revert EscrowNotFound();
        if (msg.sender != e.merchant) revert NotMerchant();
        if (e.status != Status.Active) revert WrongStatus(e.status);
        if (e.nextTier >= 4) revert AllTiersClaimed();

        uint256 cumulativeTarget = (e.totalAmount * _tierBps(e.nextTier)) / 10000;
        uint256 payout = cumulativeTarget - e.claimedAmount;

        // Effects
        e.claimedAmount = cumulativeTarget;
        uint8 claimedTier = e.nextTier;
        e.nextTier++;
        if (e.nextTier == 4) e.status = Status.Completed;

        // Interactions
        _payOut(e.token, e.merchant, payout);

        emit MilestoneClaimed(escrowId, claimedTier, payout, cumulativeTarget);
        if (e.status == Status.Completed) emit EscrowCompleted(escrowId, e.claimedAmount);
    }

    /// @notice Refund the unclaimed remainder back to payer.
    /// @dev Allowed by:
    ///        - Arbiter (if configured) at any time during Active
    ///        - Merchant (graceful release) at any time during Active
    ///      Payer self-cancel is not allowed — funds are escrowed to protect the merchant.
    function refundRemainder(bytes32 escrowId) external nonReentrant whenNotPaused {
        Escrow storage e = escrows[escrowId];
        if (e.payer == address(0)) revert EscrowNotFound();
        if (e.status != Status.Active) revert WrongStatus(e.status);

        bool isArbiter = e.arbiter != address(0) && msg.sender == e.arbiter;
        bool isMerchant = msg.sender == e.merchant;
        if (!isArbiter && !isMerchant) revert NotAuthorisedToRefund();

        uint256 remainder = e.totalAmount - e.claimedAmount;
        if (remainder == 0) revert ZeroAmount();

        // Effects
        e.claimedAmount = e.totalAmount;
        e.status = Status.Refunded;

        // Interactions
        _payOut(e.token, e.payer, remainder);

        emit EscrowRefunded(escrowId, msg.sender, remainder);
    }

    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    /// @notice View helper — preview payout for the next claim without mutating state.
    function previewNextMilestone(bytes32 escrowId) external view returns (uint8 tier, uint256 amount) {
        Escrow storage e = escrows[escrowId];
        if (e.payer == address(0) || e.status != Status.Active || e.nextTier >= 4) {
            return (e.nextTier, 0);
        }
        uint256 cumulativeTarget = (e.totalAmount * _tierBps(e.nextTier)) / 10000;
        return (e.nextTier, cumulativeTarget - e.claimedAmount);
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
