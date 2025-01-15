// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITask {
    enum TaskStatus {
        Invalid,    
        Created,    
        Running,  
        Completed,
        Failed,  
        Timeout
    }
    
    struct Task {
        bytes32 taskId;
        address dataprovider;
        uint256 creationTime;
        uint256 timeoutTimestamp;
        TaskStatus status;
        address node;
        bytes attestationProof;
        uint256 reward;
    }

    struct AttestationProof {
        bytes32[] taskIds;
        bytes proof;
    }

    function registerTask(
        bytes32 taskId,
        uint64 timeout,
        address dataprovider,
        address node,
        uint256 rewardAmount
    ) external payable;

    function submitProof(bytes32[] calldata taskIds, bytes32 merkleRoot, bytes calldata proof) external;

    function validateTask(bytes32[] calldata taskIds) external;

    function getTaskTimeout() external view returns (uint256);

    function setTaskTimeout(uint256 timeout) external;
}
