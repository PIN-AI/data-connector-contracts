// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Token is ERC20 {
    uint8 public immutable DECIMALS;
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) ERC20(_name, _symbol) {
        DECIMALS = _decimals;
        _mint(msg.sender, 999999 ether);
    }

    function mint(address toAddress, uint256 amount) public {
        _mint(toAddress, amount * (1 ether));
    }

    function mint(uint256 amount) public {
        _mint(msg.sender, amount * (1 ether));
    }

    function decimals() public view virtual override returns (uint8) {
        return DECIMALS;
    }
}
