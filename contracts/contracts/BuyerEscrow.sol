// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title BuyerEscrow — single-release escrow with buyer-controlled release
/// @notice The payer (buyer) funds the full amount upfront; the contract HOLDS it. The
///         merchant only gets paid when the BUYER confirms release — buyer protection. If the
///         buyer disappears, the merchant can claim after an optional auto-release timeout so
///         they aren't stuck. An optional arbiter can release or refund to resolve disputes.
/// @dev Complements the pass-through core invoice (opt-in custody). Pausable kill-switch,
///      ReentrancyGuard, fee-on-transfer guard. The payer cannot self-refund (funds are
///      escrowed to protect the merchant); refunds come from the merchant or the arbiter.
contract BuyerEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_AMOUNT = 1000;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    enum Status { Funded, Released, Refunded }

    struct Deal {
        address payer;
        address merchant;
        address token;        // address(0) = native QIE
        address arbiter;      // address(0) = no dispute resolver
        uint256 amount;
        uint64 fundedAt;
        uint64 autoReleaseAt; // 0 = never; else merchant may claim after this timestamp
        Status status;
    }

    mapping(bytes32 => Deal) public deals;

    event DealFunded(
        bytes32 indexed dealId,
        address indexed payer,
        address indexed merchant,
        address token,
        address arbiter,
        uint256 amount,
        uint64 autoReleaseAt
    );
    event DealReleased(bytes32 indexed dealId, address indexed by, uint256 amount);
    event DealRefunded(bytes32 indexed dealId, address indexed by, uint256 amount);

    error DealExists();
    error DealNotFound();
    error NotPayer();
    error NotMerchant();
    error NotAuthorised();
    error WrongStatus(Status current);
    error ZeroAmount();
    error WrongValue(uint256 expected, uint256 got);
    error TooEarly();
    error TransferFailed();
    error FeeOnTransferNotSupported();

    function computeDealId(address payer, address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(payer, merchant, salt, block.chainid, address(this)));
    }

    /// @notice Buyer funds an escrow. Native: send `amount` as msg.value. ERC-20: pre-approve.
    /// @param autoReleaseSeconds 0 = merchant can never force-claim; else seconds until the
    ///        merchant may claim if the buyer never confirms.
    function createEscrow(
        address merchant,
        address token,
        address arbiter,
        uint256 amount,
        uint64 autoReleaseSeconds,
        bytes32 salt
    ) external payable nonReentrant whenNotPaused returns (bytes32 dealId) {
        if (amount < MIN_AMOUNT) revert ZeroAmount();
        dealId = computeDealId(msg.sender, merchant, salt);
        if (deals[dealId].payer != address(0)) revert DealExists();

        deals[dealId] = Deal({
            payer: msg.sender,
            merchant: merchant,
            token: token,
            arbiter: arbiter,
            amount: amount,
            fundedAt: uint64(block.timestamp),
            autoReleaseAt: autoReleaseSeconds == 0 ? 0 : uint64(block.timestamp) + autoReleaseSeconds,
            status: Status.Funded
        });

        if (token == address(0)) {
            if (msg.value != amount) revert WrongValue(amount, msg.value);
        } else {
            if (msg.value != 0) revert WrongValue(0, msg.value);
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), amount);
            if (erc.balanceOf(address(this)) - before != amount) revert FeeOnTransferNotSupported();
        }

        emit DealFunded(dealId, msg.sender, merchant, token, arbiter, amount, deals[dealId].autoReleaseAt);
    }

    /// @notice Buyer (or arbiter) releases the funds to the merchant.
    function confirmRelease(bytes32 dealId) external nonReentrant whenNotPaused {
        Deal storage d = _funded(dealId);
        bool isArbiter = d.arbiter != address(0) && msg.sender == d.arbiter;
        if (msg.sender != d.payer && !isArbiter) revert NotPayer();
        _release(dealId, d);
    }

    /// @notice Merchant claims after the auto-release timeout (buyer ghosted).
    function claimAfterTimeout(bytes32 dealId) external nonReentrant whenNotPaused {
        Deal storage d = _funded(dealId);
        if (msg.sender != d.merchant) revert NotMerchant();
        if (d.autoReleaseAt == 0 || block.timestamp < d.autoReleaseAt) revert TooEarly();
        _release(dealId, d);
    }

    /// @notice Refund the buyer. Allowed by the merchant (graceful) or the arbiter (dispute).
    function refund(bytes32 dealId) external nonReentrant whenNotPaused {
        Deal storage d = _funded(dealId);
        bool isArbiter = d.arbiter != address(0) && msg.sender == d.arbiter;
        if (msg.sender != d.merchant && !isArbiter) revert NotAuthorised();

        uint256 amount = d.amount;
        d.status = Status.Refunded;
        _payOut(d.token, d.payer, amount);
        emit DealRefunded(dealId, msg.sender, amount);
    }

    function getDeal(bytes32 dealId) external view returns (Deal memory) {
        return deals[dealId];
    }

    function _funded(bytes32 dealId) internal view returns (Deal storage d) {
        d = deals[dealId];
        if (d.payer == address(0)) revert DealNotFound();
        if (d.status != Status.Funded) revert WrongStatus(d.status);
    }

    function _release(bytes32 dealId, Deal storage d) internal {
        uint256 amount = d.amount;
        d.status = Status.Released;
        _payOut(d.token, d.merchant, amount);
        emit DealReleased(dealId, msg.sender, amount);
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
