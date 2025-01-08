// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IGovernance {
    // Configuration
    function getTEEStakeThr() external view returns (uint256);
    function setStakeAmount(uint256 newAmount) external;
    function getUnstakeDelay() external view returns (uint256);
    function setUnstakeDelay(uint256 newDelay) external;
    function getMaxRewardAmount() external view returns (uint256);
    function setMaxRewardAmount(uint256 newAmount) external;

    // Owner management
    function transferOwnership(address newOwner) external;

    // Admin management
    function pause() external;
    function unpause() external;
    function revokeNodeRole(address node) external;
} 