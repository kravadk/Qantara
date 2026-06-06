// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RevertingReceiver — contract that rejects all native ETH transfers.
/// @notice Used to test push-pattern DoS resistance: when a contract has receive() revert,
///         can it block other users from claiming/withdrawing?
contract RevertingReceiver {
    fallback() external payable {
        revert("RevertingReceiver: nope");
    }

    receive() external payable {
        revert("RevertingReceiver: nope");
    }

    /// @notice Helper — call a target contract on behalf of this contract.
    function callAny(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        require(ok, "call failed");
        return ret;
    }
}
