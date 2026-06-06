// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QUSDCTestToken
/// @notice ERC-20 token used only by the contract test suite. It mirrors QUSDC decimals.
contract QUSDCTestToken is ERC20, Ownable {
    constructor(address initialOwner) ERC20("QUSDC Test Token", "QUSDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
