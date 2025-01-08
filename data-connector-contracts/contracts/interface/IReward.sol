// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IReward {
    function rewardToken() external view returns (address);
    function setRewardToken(address token) external;
    function reward(address to, uint256 amount) external;
    function rewardStorage(address account) external view returns (uint256);
}



