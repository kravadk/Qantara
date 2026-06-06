// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IERC3009Transfer {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title QantaraFees — single-payer invoices with an optional platform fee
/// @notice Behaviourally identical to Qantara, plus an owner-configured platform fee
///         (basis points) skimmed from each payment to a fee recipient. Funds still
///         settle directly to the merchant in the same transaction — the platform never
///         custodies the principal.
///
/// @dev Fee model:
///      - fee = amount * feeBps / 10_000, taken only when feeRecipient != address(0).
///      - feeBps == 0 (default) reproduces Qantara exactly: full amount to merchant.
///      - MAX_FEE_BPS caps the owner at 10% so the fee can never be set abusively high.
///      - Refunds credit the principal the merchant received (paidAmount - fee); the fee
///        already left to the recipient at payment time and is non-refundable here.
///
///      This is a NEW deployable contract — the live Qantara (V3) source is left
///      untouched so its on-chain bytecode keeps matching the repo. Deploy this and
///      point QANTARA_ADDRESS at it to enable monetization.
contract QantaraFees is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Minimum invoice amount (1000 wei). Prevents dust / griefing.
    uint256 public constant MIN_AMOUNT = 1000;
    /// @notice Hard ceiling on the platform fee: 10% (1000 bps).
    uint16 public constant MAX_FEE_BPS = 1000;

    enum InvoiceType { Standard, Donation }
    enum Status { Created, Paid, Cancelled, Refunded, Paused }

    struct Invoice {
        address merchant;
        address token;        // address(0) = native QIE
        uint256 amount;       // for Standard: exact; for Donation: minimum
        uint64 createdAt;
        uint64 expiresAt;     // 0 = never
        bytes32 metadataHash;
        address payer;        // set on payment
        uint256 paidAmount;
        uint64 paidAt;
        InvoiceType invoiceType;
        Status status;
    }

    mapping(bytes32 => Invoice) public invoices;
    mapping(address => mapping(address => uint256)) public refundBalances;

    /// @notice Platform fee in basis points (1 = 0.01%). 0 disables the fee.
    uint16 public feeBps;
    /// @notice Recipient of the platform fee. address(0) disables the fee.
    address public feeRecipient;

    event InvoiceCreated(
        bytes32 indexed invoiceHash,
        address indexed merchant,
        address indexed token,
        uint256 amount,
        InvoiceType invoiceType,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount);
    event InvoiceCancelled(bytes32 indexed invoiceHash);
    event InvoiceRefunded(bytes32 indexed invoiceHash, uint256 amount);
    event InvoicePaused(bytes32 indexed invoiceHash);
    event InvoiceResumed(bytes32 indexed invoiceHash);
    event RefundCredited(address indexed payer, address indexed token, uint256 amount);
    event RefundWithdrawn(address indexed payer, address indexed token, uint256 amount);
    event FeeConfigUpdated(uint16 feeBps, address feeRecipient);
    event FeeCollected(bytes32 indexed invoiceHash, address indexed token, address indexed recipient, uint256 fee);

    error InvalidMerchant();
    error InvoiceExists();
    error InvoiceNotFound();
    error NotMerchant();
    error WrongStatus(Status current);
    error Expired();
    error AmountMismatch(uint256 expected, uint256 got);
    error BelowMinimum(uint256 minimum, uint256 got);
    error NoRefundAvailable();
    error TransferFailed();
    error UseDedicatedERC20Path();
    error UseDedicatedNativePath();
    error FeeOnTransferNotSupported();
    error FeeTooHigh(uint16 maximum, uint16 got);

    constructor(address initialOwner, uint16 initialFeeBps, address initialFeeRecipient) Ownable(initialOwner) {
        _setFeeConfig(initialFeeBps, initialFeeRecipient);
    }

    /// @notice Owner-only kill-switch for emergency response.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the platform fee. Capped at MAX_FEE_BPS. Set recipient to
    ///         address(0) (or feeBps to 0) to disable the fee entirely.
    function setFeeConfig(uint16 newFeeBps, address newFeeRecipient) external onlyOwner {
        _setFeeConfig(newFeeBps, newFeeRecipient);
    }

    function _setFeeConfig(uint16 newFeeBps, address newFeeRecipient) internal {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(MAX_FEE_BPS, newFeeBps);
        feeBps = newFeeBps;
        feeRecipient = newFeeRecipient;
        emit FeeConfigUpdated(newFeeBps, newFeeRecipient);
    }

    /// @notice Returns the fee that would be charged on `amount` under the current config.
    function quoteFee(uint256 amount) public view returns (uint256) {
        if (feeBps == 0 || feeRecipient == address(0)) return 0;
        return (amount * feeBps) / 10_000;
    }

    function computeInvoiceHash(address merchant, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(merchant, salt, block.chainid, address(this)));
    }

    function createInvoice(
        bytes32 salt,
        address token,
        uint256 amount,
        uint64 expiresAt,
        bytes32 metadataHash,
        InvoiceType invoiceType
    ) external whenNotPaused returns (bytes32 invoiceHash) {
        if (msg.sender == address(0)) revert InvalidMerchant();
        if (amount < MIN_AMOUNT) revert BelowMinimum(MIN_AMOUNT, amount);
        invoiceHash = computeInvoiceHash(msg.sender, salt);
        if (invoices[invoiceHash].merchant != address(0)) revert InvoiceExists();

        invoices[invoiceHash] = Invoice({
            merchant: msg.sender,
            token: token,
            amount: amount,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            metadataHash: metadataHash,
            payer: address(0),
            paidAmount: 0,
            paidAt: 0,
            invoiceType: invoiceType,
            status: Status.Created
        });

        emit InvoiceCreated(invoiceHash, msg.sender, token, amount, invoiceType, expiresAt, metadataHash);
    }

    function payInvoiceNative(bytes32 invoiceHash) external payable nonReentrant whenNotPaused {
        Invoice storage inv = _getActiveInvoice(invoiceHash);
        if (inv.token != address(0)) revert UseDedicatedERC20Path();
        _validateAmount(inv, msg.value);

        inv.payer = msg.sender;
        inv.paidAmount = msg.value;
        inv.paidAt = uint64(block.timestamp);
        inv.status = Status.Paid;

        _payoutNative(invoiceHash, inv.merchant, msg.value);

        emit InvoicePaid(invoiceHash, msg.sender, msg.value);
    }

    /// @notice Pay an ERC-20 invoice. Payer must `approve(this, amountIn)` first.
    function payInvoiceERC20(bytes32 invoiceHash, uint256 amountIn) external nonReentrant whenNotPaused {
        Invoice storage inv = _getActiveInvoice(invoiceHash);
        if (inv.token == address(0)) revert UseDedicatedNativePath();
        _validateAmount(inv, amountIn);

        IERC20 token = IERC20(inv.token);

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert FeeOnTransferNotSupported();

        inv.payer = msg.sender;
        inv.paidAmount = amountIn;
        inv.paidAt = uint64(block.timestamp);
        inv.status = Status.Paid;

        _payoutERC20(invoiceHash, token, inv.merchant, amountIn);

        emit InvoicePaid(invoiceHash, msg.sender, amountIn);
    }

    /// @notice One-tx ERC-20 pay using EIP-2612 permit signature.
    function payInvoiceERC20WithPermit(
        bytes32 invoiceHash,
        uint256 amountIn,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        Invoice storage inv = _getActiveInvoice(invoiceHash);
        if (inv.token == address(0)) revert UseDedicatedNativePath();
        _validateAmount(inv, amountIn);

        IERC20Permit(inv.token).permit(msg.sender, address(this), amountIn, deadline, v, r, s);

        IERC20 token = IERC20(inv.token);

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert FeeOnTransferNotSupported();

        inv.payer = msg.sender;
        inv.paidAmount = amountIn;
        inv.paidAt = uint64(block.timestamp);
        inv.status = Status.Paid;

        _payoutERC20(invoiceHash, token, inv.merchant, amountIn);

        emit InvoicePaid(invoiceHash, msg.sender, amountIn);
    }

    /// @notice One-tx ERC-20 pay using EIP-3009 transferWithAuthorization.
    function payInvoiceERC20WithAuthorization(
        bytes32 invoiceHash,
        uint256 amountIn,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        Invoice storage inv = _getActiveInvoice(invoiceHash);
        if (inv.token == address(0)) revert UseDedicatedNativePath();
        _validateAmount(inv, amountIn);

        IERC20 token = IERC20(inv.token);

        uint256 balanceBefore = token.balanceOf(address(this));
        IERC3009Transfer(inv.token).transferWithAuthorization(
            msg.sender,
            address(this),
            amountIn,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert FeeOnTransferNotSupported();

        inv.payer = msg.sender;
        inv.paidAmount = amountIn;
        inv.paidAt = uint64(block.timestamp);
        inv.status = Status.Paid;

        _payoutERC20(invoiceHash, token, inv.merchant, amountIn);

        emit InvoicePaid(invoiceHash, msg.sender, amountIn);
    }

    function cancelInvoice(bytes32 invoiceHash) external whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Created && inv.status != Status.Paused) revert WrongStatus(inv.status);
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(invoiceHash);
    }

    /// @notice Refund a paid invoice. The merchant returns the principal they received
    ///         (paidAmount - fee). Refund is credited to the payer via the pull pattern.
    function refundInvoice(bytes32 invoiceHash) external payable nonReentrant whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Paid) revert WrongStatus(inv.status);

        // The payer is refunded the principal that actually reached the merchant; the
        // platform fee already left the contract at payment time and is non-refundable here.
        uint256 fee = quoteFee(inv.paidAmount);
        uint256 amount = inv.paidAmount - fee;
        address payer = inv.payer;
        address token = inv.token;

        inv.status = Status.Refunded;
        refundBalances[payer][token] += amount;

        if (token == address(0)) {
            if (msg.value != amount) revert AmountMismatch(amount, msg.value);
        } else {
            if (msg.value != 0) revert AmountMismatch(0, msg.value);
            IERC20 erc = IERC20(token);
            uint256 before = erc.balanceOf(address(this));
            erc.safeTransferFrom(msg.sender, address(this), amount);
            if (erc.balanceOf(address(this)) - before != amount) revert FeeOnTransferNotSupported();
        }

        emit InvoiceRefunded(invoiceHash, amount);
        emit RefundCredited(payer, token, amount);
    }

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

    function pauseInvoice(bytes32 invoiceHash) external whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Created) revert WrongStatus(inv.status);
        inv.status = Status.Paused;
        emit InvoicePaused(invoiceHash);
    }

    function resumeInvoice(bytes32 invoiceHash) external whenNotPaused {
        Invoice storage inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (msg.sender != inv.merchant) revert NotMerchant();
        if (inv.status != Status.Paused) revert WrongStatus(inv.status);
        inv.status = Status.Created;
        emit InvoiceResumed(invoiceHash);
    }

    function getInvoice(bytes32 invoiceHash) external view returns (Invoice memory) {
        return invoices[invoiceHash];
    }

    function _getActiveInvoice(bytes32 invoiceHash) internal view returns (Invoice storage inv) {
        inv = invoices[invoiceHash];
        if (inv.merchant == address(0)) revert InvoiceNotFound();
        if (inv.status != Status.Created) revert WrongStatus(inv.status);
        if (inv.expiresAt != 0 && block.timestamp > inv.expiresAt) revert Expired();
    }

    function _validateAmount(Invoice storage inv, uint256 amountIn) internal view {
        if (inv.invoiceType == InvoiceType.Standard) {
            if (amountIn != inv.amount) revert AmountMismatch(inv.amount, amountIn);
        } else {
            if (amountIn < MIN_AMOUNT) revert BelowMinimum(MIN_AMOUNT, amountIn);
            if (amountIn < inv.amount) revert BelowMinimum(inv.amount, amountIn);
        }
    }

    /// @dev Split a native payment: fee to feeRecipient (if configured), remainder to merchant.
    function _payoutNative(bytes32 invoiceHash, address merchant, uint256 amount) internal {
        uint256 fee = quoteFee(amount);
        if (fee > 0) {
            (bool okFee, ) = feeRecipient.call{value: fee}("");
            if (!okFee) revert TransferFailed();
            emit FeeCollected(invoiceHash, address(0), feeRecipient, fee);
        }
        (bool ok, ) = merchant.call{value: amount - fee}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Split an ERC-20 payment: fee to feeRecipient (if configured), remainder to merchant.
    function _payoutERC20(bytes32 invoiceHash, IERC20 token, address merchant, uint256 amount) internal {
        uint256 fee = quoteFee(amount);
        if (fee > 0) {
            token.safeTransfer(feeRecipient, fee);
            emit FeeCollected(invoiceHash, address(token), feeRecipient, fee);
        }
        token.safeTransfer(merchant, amount - fee);
    }

    receive() external payable {
        revert TransferFailed();
    }
}
