// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QantaraSplits — gas-efficient revenue-share distributor.
/// @notice Inspired by 0xSplits. Persistent recipients list, distribute() many
///         times, push-with-pull-fallback to avoid grief from a misbehaving
///         recipient.
contract QantaraSplits is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint32  public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_RECIPIENTS = 50;

    struct Split {
        address[] recipients;
        uint32[]  sharesBps;
        address   controller; // address(0) = immutable
        uint64    createdAt;
    }

    mapping(bytes32 => Split) private _splits;
    mapping(address => mapping(address => uint256)) public pendingPull;

    event SplitCreated(bytes32 indexed splitId, address indexed controller, address[] recipients, uint32[] sharesBps);
    event SplitUpdated(bytes32 indexed splitId, address[] recipients, uint32[] sharesBps);
    event Distributed(bytes32 indexed splitId, address indexed token, uint256 totalAmount);
    event RecipientPaid(bytes32 indexed splitId, address indexed recipient, address indexed token, uint256 amount, bool pushed);
    event PullWithdrawn(address indexed recipient, address indexed token, uint256 amount);

    error InvalidShares();
    error SharesSumMismatch(uint32 sum);
    error TooManyRecipients(uint256 n);
    error EmptyRecipients();
    error UnknownSplit();
    error NotController();
    error ImmutableSplit();
    error NothingToDistribute();
    error NothingToWithdraw();
    error TransferFailed();
    error FeeOnTransferNotSupported();
    error SplitExists();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function computeSplitId(address[] calldata recipients, uint32[] calldata sharesBps, bytes32 salt)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(recipients, sharesBps, salt, block.chainid, address(this)));
    }

    function createSplit(
        address[] calldata recipients,
        uint32[]  calldata sharesBps,
        address controller,
        bytes32 salt
    ) external whenNotPaused returns (bytes32 splitId) {
        _validateShape(recipients, sharesBps);
        splitId = computeSplitId(recipients, sharesBps, salt);
        if (_splits[splitId].recipients.length != 0) revert SplitExists();

        _splits[splitId] = Split({
            recipients: recipients,
            sharesBps:  sharesBps,
            controller: controller,
            createdAt:  uint64(block.timestamp)
        });
        emit SplitCreated(splitId, controller, recipients, sharesBps);
    }

    function updateSplit(bytes32 splitId, address[] calldata recipients, uint32[] calldata sharesBps)
        external whenNotPaused
    {
        Split storage s = _splits[splitId];
        if (s.recipients.length == 0) revert UnknownSplit();
        if (s.controller == address(0)) revert ImmutableSplit();
        if (msg.sender != s.controller) revert NotController();
        _validateShape(recipients, sharesBps);
        s.recipients = recipients;
        s.sharesBps  = sharesBps;
        emit SplitUpdated(splitId, recipients, sharesBps);
    }

    function getSplit(bytes32 splitId) external view returns (Split memory) {
        return _splits[splitId];
    }

    /// @notice Distribute an ERC-20 amount pulled from the caller to all recipients.
    function distributeERC20(bytes32 splitId, address token, uint256 amount)
        external nonReentrant whenNotPaused
    {
        if (token == address(0)) revert FeeOnTransferNotSupported();
        Split storage s = _splits[splitId];
        if (s.recipients.length == 0) revert UnknownSplit();
        if (amount == 0) revert NothingToDistribute();

        IERC20 erc = IERC20(token);
        uint256 before = erc.balanceOf(address(this));
        erc.safeTransferFrom(msg.sender, address(this), amount);
        if (erc.balanceOf(address(this)) - before != amount) revert FeeOnTransferNotSupported();

        _payoutAll(splitId, s, token, amount);
    }

    /// @notice Distribute msg.value native QIE to all recipients.
    function distributeNative(bytes32 splitId) external payable nonReentrant whenNotPaused {
        Split storage s = _splits[splitId];
        if (s.recipients.length == 0) revert UnknownSplit();
        if (msg.value == 0) revert NothingToDistribute();
        _payoutAll(splitId, s, address(0), msg.value);
    }

    function _payoutAll(bytes32 splitId, Split storage s, address token, uint256 amount) internal {
        uint256 distributed;
        uint256 n = s.recipients.length;
        for (uint256 i; i < n; ) {
            uint256 share = (amount * s.sharesBps[i]) / BPS_DENOMINATOR;
            if (i == n - 1) share = amount - distributed; // dust absorbed by last recipient
            address rcpt = s.recipients[i];
            bool pushed = _payRecipient(rcpt, token, share);
            if (!pushed) pendingPull[rcpt][token] += share;
            emit RecipientPaid(splitId, rcpt, token, share, pushed);
            distributed += share;
            unchecked { ++i; }
        }
        emit Distributed(splitId, token, amount);
    }

    function withdrawPull(address token) external nonReentrant whenNotPaused {
        uint256 amount = pendingPull[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();
        pendingPull[msg.sender][token] = 0;
        if (token == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit PullWithdrawn(msg.sender, token, amount);
    }

    function _payRecipient(address rcpt, address token, uint256 amount) internal returns (bool) {
        if (amount == 0) return true;
        if (token == address(0)) {
            (bool ok, ) = rcpt.call{value: amount, gas: 30_000}("");
            return ok;
        } else {
            try IERC20(token).transfer(rcpt, amount) returns (bool ok) { return ok; }
            catch { return false; }
        }
    }

    function _validateShape(address[] calldata recipients, uint32[] calldata sharesBps) internal pure {
        uint256 n = recipients.length;
        if (n == 0) revert EmptyRecipients();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients(n);
        if (sharesBps.length != n) revert InvalidShares();
        uint256 sum;
        for (uint256 i; i < n; ) {
            if (recipients[i] == address(0)) revert InvalidShares();
            if (sharesBps[i] == 0) revert InvalidShares();
            sum += sharesBps[i];
            unchecked { ++i; }
        }
        if (sum != BPS_DENOMINATOR) revert SharesSumMismatch(uint32(sum));
    }

    receive() external payable {
        // Allow plain native funding; distributors should use distributeNative.
    }
}
