// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QantaraGasRelay — minimal EIP-2771-style forwarder for gasless UX.
/// @notice Off-chain relayer submits a tx on behalf of a payer who only signed
///         an EIP-712 ForwardRequest. Target contracts must inherit
///         ERC2771Context(forwarder) to recover the original sender from the
///         trailing 20-byte calldata suffix.
contract QantaraGasRelay is EIP712, ReentrancyGuard, Pausable, Ownable {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint64  deadline;
        bytes   data;
    }

    bytes32 private constant _TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint64 deadline,bytes data)"
    );

    mapping(address => uint256) public nonces;
    /// @notice (target -> selector -> allowed). Owner-managed allowlist.
    mapping(address => mapping(bytes4 => bool)) public allowedSelectors;

    event Relayed(address indexed from, address indexed to, bytes4 selector, bool success);
    event SelectorAllowed(address indexed target, bytes4 indexed selector, bool allowed);

    error InvalidSignature();
    error ExpiredRequest();
    error NonceMismatch(uint256 expected, uint256 got);
    error CallReverted(bytes returnData);
    error SelectorNotAllowed(address target, bytes4 selector);
    error EmptyData();

    constructor(address initialOwner)
        EIP712("QantaraGasRelay", "1")
        Ownable(initialOwner)
    {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setSelectorAllowed(address target, bytes4 selector, bool allowed) external onlyOwner {
        allowedSelectors[target][selector] = allowed;
        emit SelectorAllowed(target, selector, allowed);
    }

    function setSelectorsBatch(address target, bytes4[] calldata selectors, bool allowed) external onlyOwner {
        for (uint256 i; i < selectors.length; ) {
            allowedSelectors[target][selectors[i]] = allowed;
            emit SelectorAllowed(target, selectors[i], allowed);
            unchecked { ++i; }
        }
    }

    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(
                _TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                req.deadline,
                keccak256(req.data)
            )
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        return signer == req.from && nonces[req.from] == req.nonce;
    }

    function execute(ForwardRequest calldata req, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bool success, bytes memory ret)
    {
        if (block.timestamp > req.deadline) revert ExpiredRequest();
        if (req.data.length < 4) revert EmptyData();

        bytes4 selector = bytes4(req.data[:4]);
        if (!allowedSelectors[req.to][selector]) revert SelectorNotAllowed(req.to, selector);
        if (!verify(req, signature)) revert InvalidSignature();

        // CEI: bump nonce BEFORE external call.
        unchecked { ++nonces[req.from]; }

        // Append req.from (20 bytes) to calldata. Target must use ERC2771Context.
        (success, ret) = req.to.call{value: req.value, gas: req.gas}(
            abi.encodePacked(req.data, req.from)
        );
        emit Relayed(req.from, req.to, selector, success);
        if (!success) revert CallReverted(ret);
    }

    receive() external payable {}
}
