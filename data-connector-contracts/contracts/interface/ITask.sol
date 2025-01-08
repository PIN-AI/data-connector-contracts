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
        address[] nodes;
        bytes32 inputHash;
        bytes32 resultHash;
        bytes[] attestationProofs;
        uint256 reward;
    }

    function registerTask(
        bytes32 taskId,
        bytes32 dataHash, 
        address dataprovider,
        uint256 reward
    ) external payable;
    function updateTaskStatus(bytes32 taskId, TaskStatus status) external;
    function submitProof(bytes32 taskId, bytes calldata proof) external;
    function verifyResult(bytes32 taskId) external returns (bool);
    function getTaskTimeout() external view returns (uint256);
    function setTaskTimeout(uint256 timeout) external;
}
