// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title PermitToken — ERC-20 + EIP-2612 for testing payInvoiceERC20WithPermit.
contract PermitToken is ERC20, ERC20Permit {
    constructor() ERC20("Permit Test Token", "PTT") ERC20Permit("Permit Test Token") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
