// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title QantaraReceiptRegistry
/// @notice Optional on-chain receipt anchor registry for backend-issued Qantara receipts.
/// @dev This contract does not determine paid/refunded state. Qantara payment truth remains
///      the payment contract and backend RPC/indexer verification. The registry only anchors
///      a receipt hash after the backend has issued a receipt from verified payment state.
contract QantaraReceiptRegistry is Ownable, Pausable {
    uint256 public constant MAX_URI_BYTES = 256;

    struct ReceiptAnchor {
        bytes32 invoiceHash;
        bytes32 receiptHash;
        bytes32 paymentTxHash;
        address merchant;
        address payer;
        address issuer;
        uint64 anchoredAt;
        string uri;
    }

    mapping(address => bool) public issuers;
    mapping(bytes32 => ReceiptAnchor) private anchorsByReceiptHash;
    mapping(bytes32 => bytes32) public receiptHashByInvoice;

    event IssuerUpdated(address indexed issuer, bool allowed);
    event ReceiptAnchored(
        bytes32 indexed receiptHash,
        bytes32 indexed invoiceHash,
        bytes32 indexed paymentTxHash,
        address merchant,
        address payer,
        address issuer,
        uint64 anchoredAt,
        string uri
    );

    error NotIssuer();
    error InvalidHash();
    error InvalidParty();
    error ReceiptAlreadyAnchored();
    error InvoiceAlreadyAnchored();
    error UriTooLarge(uint256 size);

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert InvalidParty();
        issuers[initialOwner] = true;
        emit IssuerUpdated(initialOwner, true);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        if (issuer == address(0)) revert InvalidParty();
        issuers[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    function anchorReceipt(
        bytes32 invoiceHash,
        bytes32 receiptHash,
        bytes32 paymentTxHash,
        address merchant,
        address payer,
        string calldata uri
    ) external whenNotPaused returns (ReceiptAnchor memory anchor) {
        if (!issuers[msg.sender]) revert NotIssuer();
        if (invoiceHash == bytes32(0) || receiptHash == bytes32(0) || paymentTxHash == bytes32(0)) {
            revert InvalidHash();
        }
        if (merchant == address(0) || payer == address(0)) revert InvalidParty();
        if (bytes(uri).length > MAX_URI_BYTES) revert UriTooLarge(bytes(uri).length);
        if (anchorsByReceiptHash[receiptHash].anchoredAt != 0) revert ReceiptAlreadyAnchored();
        if (receiptHashByInvoice[invoiceHash] != bytes32(0)) revert InvoiceAlreadyAnchored();

        anchor = ReceiptAnchor({
            invoiceHash: invoiceHash,
            receiptHash: receiptHash,
            paymentTxHash: paymentTxHash,
            merchant: merchant,
            payer: payer,
            issuer: msg.sender,
            anchoredAt: uint64(block.timestamp),
            uri: uri
        });

        anchorsByReceiptHash[receiptHash] = anchor;
        receiptHashByInvoice[invoiceHash] = receiptHash;

        emit ReceiptAnchored(
            receiptHash,
            invoiceHash,
            paymentTxHash,
            merchant,
            payer,
            msg.sender,
            anchor.anchoredAt,
            uri
        );
    }

    function getReceiptAnchor(bytes32 receiptHash) external view returns (ReceiptAnchor memory) {
        return anchorsByReceiptHash[receiptHash];
    }

    function getInvoiceAnchor(bytes32 invoiceHash) external view returns (ReceiptAnchor memory) {
        return anchorsByReceiptHash[receiptHashByInvoice[invoiceHash]];
    }

    function isAnchored(bytes32 receiptHash) external view returns (bool) {
        return anchorsByReceiptHash[receiptHash].anchoredAt != 0;
    }
}
