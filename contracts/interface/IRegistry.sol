// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IRegistry {
    // TEE
    enum TEEType {
        DataConnecter,
        AICompute,
        PrivacyCompute,
        Storage,
        Validation
    }
    // TEE
    struct TEENode {
        address nodeAddress;
        address rewardAddress;
        bytes publicKey;
        string apiEndpoint;
        uint256 registerTime;
        bytes32 attestationProofHash;
        NodeStatus status;
        TEEType teeType;
        uint256 stakeAmount;
    }
    struct TEERegistryParams {
        address nodeAddress;
        address rewardAddress;
        bytes publicKey;
        string apiEndpoint;
        TEEType teeType;
    }

    struct User {
        bytes publicKey;
        uint256 registerTime;
        UserStatus status;
    }
    struct UserRegistryParams {
        address userAddress;
        bytes publicKey;
    }

    enum NodeStatus {
        Suspended,
        Registered,
        RegisteredAndStaked,
        Verified,
        Active
    }

    enum UserStatus {
        Suspended,
        Registered,
        Verified,
        Active
    }

    function registerUser(UserRegistryParams calldata params) external;

    function registerNode(TEERegistryParams calldata params) payable external;

    function isRegisteredNode(address node) external view returns (bool);

    function isRegisteredUser(address user) external view returns (bool);

    function getNodeCredit(address node) external view returns (uint256);
    
    function getUserCredit(address user) external view returns (uint256);
}
