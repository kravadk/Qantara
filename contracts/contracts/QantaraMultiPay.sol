// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QantaraMultiPay — collective invoices (multi-payer)
/// @notice Any number of payers can contribute to the same invoice. Merchant settles when goal
///         is reached (or whenever they want). Cancellation refunds via pull pattern — no loop.
/// @dev Pausable kill-switch (Owner). Fee-on-transfer tokens are rejected in contributeERC20.
contract QantaraMultiPay is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_AMOUNT = 1000;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    enum Status { Open, Settled, Cancelled }

    struct Invoice {
        address merchant;
        address token;       // address(0) = native QIE
        uint256 goal;        // 0 = no goal (purely collective)
        uint256 totalRaised;
        uint64 createdAt;
        uint64 expiresAt;    // 0 = never
        bytes32 metadataHash;
        Status status;
    }

    mapping(bytes32 => Invoice) public invoices;
    /// @dev invoiceHash => payer => amount contributed
    mapping(bytes32 => mapping(address => uint256)) public contributions;
    /// @dev payer => token => withdrawable amount (refund pool)
    mapping(address => mapping(address => uint256)) public refundBalances;

    event MultiPayCreated(
        bytes32 indexed invoiceHash,
        address indexed merchant,
        address indexed token,
        uint256 goal,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event MultiPayContribution(
        bytes32 indexed invoiceHash,
        address indexed payer,
        uint256 amount,
        uint256 newTotal
    );
    event MultiPaySettled(bytes32 indexed invoiceHash, uint256 totalRaised);
    event MultiPayCancelled(bytes32 indexed invoiceHash);
    event RefundCredited(address indexed payer, address indexed token, uint256 amount);
    event RefundWithdrawn(address indexed payer, address indexed token, uint256 amount);

    error InvoiceExists();
    error InvoiceNotFound();
    error NotMerchant();
    error WrongStatus(Status current);
    error Expired();
    error ZeroAmount();
    error NoContribution();
    error UseDedicatedERC20Path();
    error UseDedicatedNativePath();
    error TransferFailed();
    error AmountMismatch(uint256 expected, uint256 got);
    error NoRefundAvailable();
    error FeeOnTransferNotSupported();

    function computeInvoiceHash(address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(merchant, salt, block.chainid, address(this)));
    }

    function createInvoice(
        bytes32 salt,
        address token,
        uint256 goal,
        uint64 expiresAt,
        bytes32 metadataHash
    ) external whenNotPaused returns (bytes32 invoiceHash) {
        invoiceHash = computeInvoiceHash(msg.sender, salt);
        if (invoices[invoiceHash].merchant != address(0)) revert InvoiceExists();

        invoices[invoiceHash] = Invoice({
            merchant: msg.sender,
            token: token,
            goal: goal,
            totalRaised: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            status: Status.Open
        });

        emit MultiPayCreated(invoiceHash, msg.sender, token, goal, expiresAt, metadataHash);
    }

    /// @notice Contribute native QIE.
    function contributeNative(bytes32 invoiceHash) external payable nonReentrant whenNotPaused {
        Invoice storage inv = _getOpenInvoice(invoiceHash);
        if (inv.token != address(0)) revert UseDedicatedERC20Path();
        if (msg.value < MIN_AMOUNT) revert ZeroAmount();

        contributions[invoiceHash][msg.sender] += msg.value;
        inv.totalRaised += msg.value;

        emit MultiPayContribution(invoiceHash, msg.sender, msg.value, inv.totalRaised);
    }

    /// @notice Contribute ERC-20. Payer must approve `amountIn` to this contract first.
    /// @dev Fee-on-transfer guard: rejects tokens that take a tax on transfer.
    function contributeERC20(bytes32 invoiceHash, uint256 amountIn) external nonReentrant whenNotPaused {
        Invoice storage inv = _getOpenInvoice(invoiceHash);
        if (inv.token == address(0)) revert UseDedicatedNativePath();
        if (amountIn < MIN_AMOUNT) revert ZeroAmount();

        // Interactions first to validate actual received amount (FoT guard)
        IERC20 token = IERC20(inv.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert FeeOnTransferNotSupported();

        // Effects
        contributions[invoiceHash][msg.sender] += amountIn;
        inv.totalRaised += amountIn;

        emit MultiPayContribution(invoiceHash, msg.sender, amountIn, inv.totalRaised);
    }

    /// @notice Merchant settles — pays out the pool to themselves and closes the invoice.
    function settleInvoice(bytes32 invoiceHash) external nonReentrant whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Open) revert WrongStatus(inv.status);

        uint256 total = inv.totalRaised;
        inv.status = Status.Settled;

        if (total > 0) {
            if (inv.token == address(0)) {
                (bool ok, ) = inv.merchant.call{value: total}("");
                if (!ok) revert TransferFailed();
            } else {
                IERC20(inv.token).safeTransfer(inv.merchant, total);
            }
        }
        emit MultiPaySettled(invoiceHash, total);
    }

    /// @notice Merchant cancels — payers withdraw their contributions via claimRefund (pull).
    function cancelInvoice(bytes32 invoiceHash) external whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Open) revert WrongStatus(inv.status);

        inv.status = Status.Cancelled;
        emit MultiPayCancelled(invoiceHash);
    }

    /// @notice After cancel/expiry, payer moves their contribution into the withdrawable pool.
    function claimRefund(bytes32 invoiceHash) external whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();

        bool refundable = inv.status == Status.Cancelled
            || (inv.status == Status.Open && inv.expiresAt != 0 && block.timestamp > inv.expiresAt);
        if (!refundable) revert WrongStatus(inv.status);

        uint256 amount = contributions[invoiceHash][msg.sender];
        if (amount == 0) revert NoContribution();

        contributions[invoiceHash][msg.sender] = 0;
        refundBalances[msg.sender][inv.token] += amount;

        emit RefundCredited(msg.sender, inv.token, amount);
    }

    /// @notice Withdraw all refunds accumulated for a token.
    function withdrawRefund(address token) external nonReentrant whenNotPaused {
        uint256 amount = refundBalances[msg.sender][token];
        if (amount == 0) revert NoRefundAvailable();

        refundBalances[msg.sender][token] = 0;

        if (token == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit RefundWithdrawn(msg.sender, token, amount);
    }

    function getInvoice(bytes32 invoiceHash) external view returns (Invoice memory) {
        return invoices[invoiceHash];
    }

    function getContribution(bytes32 invoiceHash, address payer) external view returns (uint256) {
        return contributions[invoiceHash][payer];
    }

    function _getOpenInvoice(bytes32 invoiceHash) internal view returns (Invoice storage inv) {
        inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.status != Status.Open) revert WrongStatus(inv.status);
        if (inv.expiresAt != 0 && block.timestamp > inv.expiresAt) revert Expired();
    }

    receive() external payable {
        revert TransferFailed();
    }
}
