// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "./lib/Pausable.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {IStaking} from "./interface/IStaking.sol";
import {IRegistry} from "./interface/IRegistry.sol";
import {ITask} from "./interface/ITask.sol";
import {IReward} from "./interface/IReward.sol";
import {IEvent} from "./interface/IEvent.sol";
import "./interface/IGovernance.sol";

contract TEEGovernance is 
    Initializable,
    UUPSUpgradeable,
    Pausable,
    AccessControlUpgradeable,
    IStaking,
    ITask,
    IRegistry,
    IEvent,
    IReward,
    IGovernance
{
    using ECDSA for bytes32;

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TEE_NODE_ROLE = keccak256("TEE_NODE_ROLE");
    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint256 private _stakeAmount;
    uint256 private _unstakeDelay;
    uint256 private _taskTimeout;
    address private _rewardToken;
    uint256 private _maxRewardAmount;

    mapping(address => User) public users;
    mapping(bytes32 => Task) public tasks;
    mapping(address => TEENode) public nodes;
    mapping(address => uint256) public nodeCredits;
    mapping(address => uint256) public userCredits;
    mapping(address => uint256) public rewardStorage;
    mapping(address => UnstakeRequest) public unstakeRequests;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {
        // if (hasRole(TEE_NODE_ROLE, _msgSender())) {
        //     _stake(msg.value, _msgSender());
        //     emit StakeDeposited(_msgSender(), msg.value);
        // }
    }

    function initialize() public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(OWNER_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SCHEDULER_ROLE, msg.sender);
        _setRoleAdmin(SCHEDULER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(TEE_NODE_ROLE, ADMIN_ROLE);
        _setRoleAdmin(SIGNER_ROLE, OWNER_ROLE);

        _stakeAmount = 0.05 ether;
        _unstakeDelay = 1 minutes;
        _taskTimeout = 7 days;
        _rewardToken = address(0); // Default to ETH
    }

    function registerNode(
        TEERegistryParams calldata params,
        bytes calldata attestation
    ) external payable override whenNotPaused {
        require(nodes[params.nodeAddress].nodeAddress == address(0), "Node already registered");
        require(msg.value >= _stakeAmount, "Insufficient stake amount");
        require(
            hasRole(
                SIGNER_ROLE, 
                _ecdsaRecover(_calculateTEERegistryHash(params), attestation)
            ), 
            "Invalid attestation signer"
        );
        
        _grantRole(TEE_NODE_ROLE, params.nodeAddress);

        nodes[params.nodeAddress] = TEENode({
            nodeAddress: params.nodeAddress,
            rewardAddress: params.rewardAddress,
            publicKey: params.publicKey,
            apiEndpoint: params.apiEndpoint,
            registerTime: params.registerTime,
            attestationProof: attestation,
            status: NodeStatus.RegisteredAndStaked,
            teeType: params.teeType,
            stakeAmount: msg.value
        });

        emit NodeRegistered(
            params.nodeAddress,
            params.rewardAddress,
            _msgSender(),
            msg.value,
            params.publicKey,
            params.apiEndpoint,
            params.teeType
        );
    }

    function registerUser(
        UserRegistryParams calldata params,
        bytes calldata credentials
    ) external override whenNotPaused {
        require(users[params.userAddress].userAddress == address(0), "User already registered");
        require(hasRole(
            SIGNER_ROLE,
            _ecdsaRecover(_calculateUserRegistryHash(params), credentials)
            ), 
            "Invalid credentials signer"
        );

        users[params.userAddress] = User({
            userAddress: params.userAddress,
            publicKey: params.publicKey,
            registerTime: block.timestamp,
            status: UserStatus.Registered
        });

        emit UserRegistered(
            params.userAddress,
            _msgSender(),
            params.publicKey,
            UserStatus.Registered
        );
    }

    function unstakeRequest() external override whenNotPaused {
        require(hasRole(TEE_NODE_ROLE, _msgSender()), "Not a TEE node");
        TEENode memory node = nodes[_msgSender()];
        require(node.stakeAmount >= _stakeAmount, "Invalid stake amount");
        unstakeRequests[_msgSender()] = UnstakeRequest({
            amount: node.stakeAmount,
            unStakeTime: block.timestamp + _unstakeDelay
        });

        nodes[_msgSender()].status = NodeStatus.Suspended;
        emit UnstakeRequested(_msgSender(), block.timestamp);
    }

    function cancelUnstake() external override whenNotPaused {
        require(hasRole(TEE_NODE_ROLE, _msgSender()), "Not a TEE node");
        require(nodes[_msgSender()].status == NodeStatus.Suspended, "Node not suspended");
        require(unstakeRequests[_msgSender()].unStakeTime > 0, "No unstake request found");
        delete unstakeRequests[_msgSender()];

        nodes[_msgSender()].status = _getTEEStakedAmount(_msgSender()) >= _stakeAmount ? NodeStatus.RegisteredAndStaked : NodeStatus.Registered;
        emit UnstakeCancelled(_msgSender());
    }

    function unstake() external override whenNotPaused {
        require(hasRole(TEE_NODE_ROLE, _msgSender()), "Not a TEE node");
        UnstakeRequest memory request = unstakeRequests[_msgSender()];
        require(
            request.unStakeTime < block.timestamp && 
            request.unStakeTime > 0, "Unstake delay not passed");

        delete nodes[_msgSender()];
        delete unstakeRequests[_msgSender()];
        (bool success, ) = _msgSender().call{value: request.amount}("");
        require(success, "ETH transfer failed");
        
        emit UnstakeCompleted(_msgSender(), request.amount);
    }

    function slash(address node, uint256 amount) external override onlyRole(ADMIN_ROLE) {
         require(amount <= nodes[node].stakeAmount, "Invalid slash amount");
        
        nodes[node].stakeAmount -= amount;
        if (nodes[node].stakeAmount == 0) {
            nodes[node].status = NodeStatus.Suspended;
        }
        
        emit Slashed(node, _msgSender(), amount);
    }

    function pause() external override onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function getStakedAmount(address node) external view override returns (uint256) {
        return nodes[node].stakeAmount;
    }

    function isRegisteredNode(address node) external view override returns (bool) {
        return nodes[node].nodeAddress != address(0);
    }

    function isRegisteredUser(address user) external view override returns (bool) {
        return users[user].userAddress != address(0);
    }

    function getNodeCredit(address node) external view override returns (uint256) {
        return nodeCredits[node];
    }

    function getUserCredit(address user) external view override returns (uint256) {
        return userCredits[user];
    }

    function revokeNodeRole(address node) external onlyRole(ADMIN_ROLE) {
        require(nodes[node].nodeAddress != address(0), "Node not registered");
        require(nodes[node].status != NodeStatus.Active, "Node is active");
        
        delete nodes[node];
        _revokeRole(TEE_NODE_ROLE, node);
    }

    function getTEEStakeThr() public view override returns (uint256) {
        return _stakeAmount;
    }

    function setStakeAmount(uint256 newAmount) external override onlyRole(ADMIN_ROLE) {
        require(newAmount > 0, "Invalid stake amount");
        emit StakeAmountUpdated(_stakeAmount, newAmount);
        _stakeAmount = newAmount;
    }

    function getUnstakeDelay() public view override returns (uint256) {
        return _unstakeDelay;
    }

    function setUnstakeDelay(uint256 newDelay) external override onlyRole(ADMIN_ROLE) {
        require(newDelay > 0, "Invalid delay period");
        emit UnstakeDelayUpdated(_unstakeDelay, newDelay);
        _unstakeDelay = newDelay;
    }

    function transferOwnership(address newOwner) external override onlyRole(OWNER_ROLE) {
        require(newOwner != address(0), "New owner is the zero address");
        require(newOwner != msg.sender, "New owner is the current owner");
        
        _grantRole(OWNER_ROLE, newOwner);
        _revokeRole(OWNER_ROLE, msg.sender);
        
        emit OwnershipTransferred(msg.sender, newOwner);
    }

    function registerTask(
        bytes32 taskId,
        bytes32 dataHash, 
        address dataprovider,
        uint256 rewardAmount
    ) external payable override whenNotPaused onlyRole(SCHEDULER_ROLE) {
        require(tasks[taskId].taskId == bytes32(0), "Task already exists");
        require(dataprovider != address(0), "Invalid dataprovider");
        require(rewardAmount > 0, "Invalid reward amount");
        require(rewardAmount <= _maxRewardAmount, "Reward exceeds maximum");
        
        tasks[taskId] = Task({
            taskId: taskId,
            dataprovider: dataprovider,
            creationTime: block.timestamp,
            timeoutTimestamp: block.timestamp + _taskTimeout,
            status: TaskStatus.Created,
            nodes: new address[](0),
            inputHash: dataHash,
            resultHash: bytes32(0),
            attestationProofs: new bytes[](0),
            reward: rewardAmount
        });
        
        emit TaskRegistered(taskId, dataHash, dataprovider, rewardAmount);
    }

    function updateTaskStatus(
        bytes32 taskId, 
        TaskStatus status
    ) external override whenNotPaused onlyRole(SCHEDULER_ROLE) {
        Task memory task = tasks[taskId];
        require(task.taskId != bytes32(0), "Task not found");
        if (status == TaskStatus.Completed) {
            require(task.status != TaskStatus.Completed, "Task already completed");
            uint256 nodeCount = task.nodes.length;
            require(nodeCount > 0, "No nodes to reward");
            uint256 rewardPerNode = task.reward / (nodeCount + 1);
            rewardStorage[task.dataprovider] += rewardPerNode;
            for(uint256 i = 0; i < nodeCount ; i++) {
                address rewardAddress = nodes[task.nodes[i]].rewardAddress;
                rewardStorage[rewardAddress] += rewardPerNode;
            }
        }
        tasks[taskId].status = status;
        emit TaskStatusUpdated(taskId, status);
    }

    function submitProof(
        bytes32 taskId, 
        bytes calldata proof
    ) external override whenNotPaused onlyRole(TEE_NODE_ROLE) {
        Task memory task = tasks[taskId];
        require(task.taskId != bytes32(0), "Task not found");
        require(_isTaskValid(task), "Task invalid");
        bytes32 proofHash = _calculateTaskProofHash(taskId, task.inputHash, _msgSender());
        address _signer = _ecdsaRecover(proofHash, proof);
        require(hasRole(SIGNER_ROLE, _signer), "Invalid proof signer");
        tasks[taskId].attestationProofs.push(proof);
        tasks[taskId].nodes.push(_msgSender());

        emit ProofSubmitted(taskId, _msgSender(), proofHash);
    }

    function rewardToken() external view override returns (address) {
        return _rewardToken;
    }

    function setRewardToken(address token) external override onlyRole(ADMIN_ROLE) {
        emit RewardTokenUpdated(_rewardToken, token);
        _rewardToken = token;
    }

    function reward(address node, uint256 amount) external override whenNotPaused {
        address to = nodes[node].rewardAddress;
        require(_msgSender() == to || _msgSender() == node, "Not the reward address");
        require(rewardStorage[to] >= amount, "Insufficient reward balance");
        rewardStorage[to] -= amount;
        
        if (_rewardToken == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(_rewardToken).transfer(to, amount);
        }
        
        emit RewardClaimed(to, amount);
    }

        function _calculateTEERegistryHash(
        TEERegistryParams calldata params
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            params.nodeAddress, 
            params.rewardAddress, 
            params.publicKey, 
            params.apiEndpoint, 
            params.registerTime, 
            params.teeType,
            address(this),
            block.chainid
        ));
    }

    function _calculateUserRegistryHash(
        UserRegistryParams calldata params
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            params.userAddress, 
            params.publicKey,
            address(this),
            block.chainid
        ));
    }

    function _calculateTaskProofHash(
        bytes32 taskId,
        bytes32 dataHash,
        address node
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(taskId, dataHash, node, address(this), block.chainid));
    }

    function _ecdsaRecover(
        bytes32 message,
        bytes calldata signature
    ) internal view returns (address) {
        return message.toEthSignedMessageHash().recover(signature);
    }

    function _getTEEStakedAmount(address node) internal view returns (uint256) {
        return nodes[node].stakeAmount;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(OWNER_ROLE) { }

    function _isTaskValid(Task memory task) internal view returns (bool) {
        return (
            block.timestamp < task.timeoutTimestamp && 
            task.status == TaskStatus.Created
        );
    }

    function getTaskTimeout() external view override returns (uint256) {
        return _taskTimeout;
    }

    function setTaskTimeout(uint256 timeout) external override onlyRole(ADMIN_ROLE) {
        require(timeout > 0, "Invalid timeout value");
        emit TaskTimeoutUpdated(_taskTimeout, timeout);
        _taskTimeout = timeout;
    }

    function verifyResult(bytes32 taskId) public view override returns (bool) {
        Task storage task = tasks[taskId];
        require(task.taskId != bytes32(0), "Task not found");
        require(task.attestationProofs.length > 0, "No proofs submitted");
        
        // Basic verification: check if we have at least one proof
        // In production, implement more sophisticated verification logic
        return true;
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).transfer(to, amount);
        }
    }

    function _contains(address[] memory array, address element) internal pure returns (bool) {
        for(uint256 i = 0; i < array.length; i++) {
            if(array[i] == element) return true;
        }
        return false;
    }

    function getMaxRewardAmount() external view override returns (uint256) {
        return _maxRewardAmount;
    }

    function setMaxRewardAmount(uint256 newAmount) external override onlyRole(ADMIN_ROLE) {
        require(newAmount > 0, "Invalid max reward amount");
        emit MaxRewardAmountUpdated(_maxRewardAmount, newAmount);
        _maxRewardAmount = newAmount;
    }
} 