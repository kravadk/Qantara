// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FeeOnTransferToken — adversarial ERC-20 that takes a 5% fee on every transfer.
/// @notice Used in tests to verify that fee-on-transfer guards reject this token.
contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 500; // 5%

    constructor() ERC20("FeeOnTransfer", "FOT") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / 10000;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
