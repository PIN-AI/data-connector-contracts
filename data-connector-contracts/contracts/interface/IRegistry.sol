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
        bytes attestationProof;
        NodeStatus status;
        TEEType teeType;
        uint256 stakeAmount;
    }
    struct TEERegistryParams {
        address nodeAddress;
        address rewardAddress;
        bytes publicKey;
        string apiEndpoint;
        uint256 registerTime;
        TEEType teeType;
    }

    struct User {
        address userAddress;
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

    function registerUser(UserRegistryParams calldata params, bytes calldata credentials) external;

    function registerNode(TEERegistryParams calldata params, bytes calldata attestation) payable external;

    function isRegisteredNode(address node) external view returns (bool);

    function isRegisteredUser(address user) external view returns (bool);

    function getNodeCredit(address node) external view returns (uint256);
    
    function getUserCredit(address user) external view returns (uint256);
}
