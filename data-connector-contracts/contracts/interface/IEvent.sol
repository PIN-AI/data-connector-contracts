// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./IRegistry.sol";
import "./ITask.sol";

interface IEvent {
    event NodeRegistered(
        address indexed node,
        address indexed rewardAddress,
        address indexed signer,
        uint256 stakeAmount,
        bytes publicKey,
        string apiEndpoint,
        IRegistry.TEEType teeType
    );
    
    event UserRegistered(
        address indexed user,
        address indexed signer,
        bytes publicKey,
        IRegistry.UserStatus status
    );
    event StakeDeposited(address indexed node, uint256 amount);
    event UnstakeRequested(address indexed node, uint256 unStakeTime);
    event UnstakeCancelled(address indexed node);
    event UnstakeCompleted(address indexed node, uint256 amount);
    event TaskCreated(bytes32 indexed taskId, address indexed dataprovider);
    event TaskCompleted(bytes32 indexed taskId);
    event Slashed(
        address indexed node, 
        address indexed signer,
        uint256 indexed amount
    );
    event StakeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event UnstakeDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TaskRegistered(
        bytes32 indexed taskId, 
        bytes32 dataHash,
        address indexed dataprovider,
        uint256 reward
    );
    event TaskStatusUpdated(bytes32 indexed taskId, ITask.TaskStatus status);
    event ProofSubmitted(bytes32 indexed taskId, address indexed node, bytes32 indexed proofHash);
    event RewardTokenUpdated(address oldToken, address newToken);
    event RewardClaimed(address indexed to, uint256 amount);
    event TaskTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event MaxRewardAmountUpdated(uint256 oldAmount, uint256 newAmount);
}