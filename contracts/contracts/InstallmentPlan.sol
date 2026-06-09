// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title InstallmentPlan — pay-over-time (BNPL-style) plans on QIE
/// @notice The payer commits to N installments of a fixed amount and pays them one (or
///         several) at a time on their own schedule. The merchant claims installments that
///         have already been paid. The payer can cancel at any time and is refunded any
///         installment they paid that the merchant has not yet claimed.
/// @dev Not prefunded — unlike RecurringScheduler/SubscriptionV2 the payer does NOT lock the
///      full amount upfront; they deposit each installment when they choose. `interval` is the
///      schedule cadence used by clients to show due dates; it is not enforced on-chain (the
///      payer may pay early). Pausable kill-switch (Owner). Fee-on-transfer tokens rejected.
contract InstallmentPlan is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_AMOUNT_PER_INSTALLMENT = 1000;
    uint32 public constant MAX_INSTALLMENTS = 120;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    enum Status { Active, Completed, Cancelled }

    struct Plan {
        address payer;
        address merchant;
        address token;             // address(0) = native QIE
        uint256 amountPerInstallment;
        uint64 interval;           // seconds between scheduled installments (client-side cadence)
        uint32 totalInstallments;
        uint32 paidInstallments;   // installments the payer has deposited
        uint32 claimedInstallments;// installments the merchant has withdrawn
        uint64 createdAt;
        Status status;
    }

    mapping(bytes32 => Plan) public plans;

    event PlanCreated(
        bytes32 indexed planId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amountPerInstallment,
        uint64 interval,
        uint32 totalInstallments
    );
    event InstallmentsPaid(bytes32 indexed planId, uint32 paidInstallments, uint256 amount);
    event InstallmentsClaimed(bytes32 indexed planId, uint32 claimedInstallments, uint256 amount);
    event PlanCompleted(bytes32 indexed planId);
    event PlanCancelled(bytes32 indexed planId, uint256 refundedToPayer);

    error PlanExists();
    error PlanNotFound();
    error NotPayer();
    error NotMerchant();
    error WrongStatus(Status current);
    error ZeroAmount();
    error ZeroInstallments();
    error TooManyInstallments();
    error ZeroInterval();
    error InvalidInstallmentCount();
    error NothingToClaim();
    error WrongValue(uint256 expected, uint256 got);
    error TransferFailed();
    error FeeOnTransferNotSupported();

    /// @notice Deterministic plan id — UI can pre-compute before mining.
    function computePlanId(address payer, address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(payer, merchant, salt, block.chainid, address(this)));
    }

    /// @notice Open a plan. msg.sender == payer. No upfront funding.
    function createPlan(
        address merchant,
        address token,
        uint256 amountPerInstallment,
        uint64 interval,
        uint32 totalInstallments,
        bytes32 salt
    ) external whenNotPaused returns (bytes32 planId) {
        if (amountPerInstallment < MIN_AMOUNT_PER_INSTALLMENT) revert ZeroAmount();
        if (totalInstallments == 0) revert ZeroInstallments();
        if (totalInstallments > MAX_INSTALLMENTS) revert TooManyInstallments();
        if (interval == 0) revert ZeroInterval();

        planId = computePlanId(msg.sender, merchant, salt);
        if (plans[planId].payer != address(0)) revert PlanExists();

        plans[planId] = Plan({
            payer: msg.sender,
            merchant: merchant,
            token: token,
            amountPerInstallment: amountPerInstallment,
            interval: interval,
            totalInstallments: totalInstallments,
            paidInstallments: 0,
            claimedInstallments: 0,
            createdAt: uint64(block.timestamp),
            status: Status.Active
        });

        emit PlanCreated(planId, msg.sender, merchant, token, amountPerInstallment, interval, totalInstallments);
    }

    /// @notice Pay `count` more installments. For native: send exactly count*amount as msg.value.
    ///         For ERC-20: pre-approve count*amount to this contract.
    function payInstallments(bytes32 planId, uint32 count) external payable nonReentrant whenNotPaused {
        Plan storage p = plans[planId];
        if (p.payer == address(0)) revert PlanNotFound();
        if (msg.sender != p.payer) revert NotPayer();
        if (p.status != Status.Active) revert WrongStatus(p.status);
        if (count == 0 || p.paidInstallments + count > p.totalInstallments) revert InvalidInstallmentCount();

        uint256 total = uint256(count) * p.amountPerInstallment;

        // Effects
        p.paidInstallments += count;

        // Interactions
        if (p.token == address(0)) {
            if (msg.value != total) revert WrongValue(total, msg.value);
        } else {
            if (msg.value != 0) revert WrongValue(0, msg.value);
            IERC20 erc = IERC20(p.token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), total);
            if (erc.balanceOf(address(this)) - before != total) revert FeeOnTransferNotSupported();
        }

        emit InstallmentsPaid(planId, p.paidInstallments, total);
    }

    /// @notice Merchant withdraws all paid-but-unclaimed installments.
    function claimInstallments(bytes32 planId) external nonReentrant whenNotPaused {
        Plan storage p = plans[planId];
        if (p.payer == address(0)) revert PlanNotFound();
        if (msg.sender != p.merchant) revert NotMerchant();
        if (p.status != Status.Active) revert WrongStatus(p.status);

        uint32 claimable = p.paidInstallments - p.claimedInstallments;
        if (claimable == 0) revert NothingToClaim();

        uint256 amount = uint256(claimable) * p.amountPerInstallment;

        // Effects
        p.claimedInstallments = p.paidInstallments;
        if (p.claimedInstallments == p.totalInstallments) p.status = Status.Completed;

        // Interactions
        _payOut(p.token, p.merchant, amount);

        emit InstallmentsClaimed(planId, p.claimedInstallments, amount);
        if (p.status == Status.Completed) emit PlanCompleted(planId);
    }

    /// @notice Payer cancels the plan; any paid-but-unclaimed installments are refunded.
    function cancelPlan(bytes32 planId) external nonReentrant whenNotPaused {
        Plan storage p = plans[planId];
        if (p.payer == address(0)) revert PlanNotFound();
        if (msg.sender != p.payer) revert NotPayer();
        if (p.status != Status.Active) revert WrongStatus(p.status);

        uint256 refund = uint256(p.paidInstallments - p.claimedInstallments) * p.amountPerInstallment;

        // Effects
        p.claimedInstallments = p.paidInstallments; // nothing left claimable for merchant
        p.status = Status.Cancelled;

        // Interactions
        if (refund > 0) _payOut(p.token, p.payer, refund);

        emit PlanCancelled(planId, refund);
    }

    function getPlan(bytes32 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    /// @notice Scheduled due date for installment index `n` (1-based), for client display.
    function dueAt(bytes32 planId, uint32 n) external view returns (uint64) {
        Plan storage p = plans[planId];
        if (p.payer == address(0) || n == 0 || n > p.totalInstallments) return 0;
        return p.createdAt + uint64(n - 1) * p.interval;
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
