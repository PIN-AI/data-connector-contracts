// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IStaking {
    struct UnstakeRequest {
        uint64 unStakeTime;
    }

    function unstakeRequest() external;

    function cancelUnstake() external;

    function unstake() external;

    function slash(address node, uint256 amount) external;

    function getStakedAmount(address node) external view returns (uint256);
}
