// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
    using SafeERC20 for IERC20;

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TEE_NODE_ROLE = keccak256("TEE_NODE_ROLE");
    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    uint256 private _stakeAmount;
    uint256 private _unstakeDelay;
    uint256 private _taskTimeout;
    address private _rewardToken;
    uint256 private _maxRewardAmount;
    uint256 private _minTaskTimeout;
    
    mapping(address => User) public users;
    mapping(bytes32 => Task) public tasks;
    mapping(address => TEENode) public nodes;
    mapping(address => uint256) public nodeCredits;
    mapping(address => uint256) public userCredits;
    mapping(address => uint256) public rewardStorage;
    mapping(address => UnstakeRequest) public unstakeRequests;
    mapping(bytes32 => AttestationProof) public attestationProofs;

    address[] private nodeAddresses;

    bool private _isRewardTokenEnable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {
        // receive ETH
    }

    function initialize() public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(OWNER_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(SCHEDULER_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);

        _setRoleAdmin(SCHEDULER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(TEE_NODE_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(VALIDATOR_ROLE, OWNER_ROLE);

        _stakeAmount = 0.05 ether;
        _unstakeDelay = 1 minutes;
        _taskTimeout = 7 days;
        _rewardToken = address(0); // Default to ETH
        _minTaskTimeout = 3 minutes;
        _maxRewardAmount = 32 ether;
        _isRewardTokenEnable = false;
    }

    modifier onlyRewardTokenEnable() {
        require(_isRewardTokenEnable, "Reward token not enabled");
        _;
    }

    function registerNode(
        TEERegistryParams calldata params
    ) external payable override whenNotPaused {
        require(nodes[params.nodeAddress].nodeAddress == address(0), "Node already registered");
        require(msg.value >= _stakeAmount, "Insufficient stake amount");
        
        _grantRole(TEE_NODE_ROLE, params.nodeAddress);
        nodeAddresses.push(params.nodeAddress);

        nodes[params.nodeAddress] = TEENode({
            nodeAddress: params.nodeAddress,
            rewardAddress: params.rewardAddress,
            publicKey: params.publicKey,
            apiEndpoint: params.apiEndpoint,
            registerTime: block.timestamp,
            attestationProofHash: bytes32(0),
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
        UserRegistryParams calldata params
    ) external override whenNotPaused {
        require(hasRole(ADMIN_ROLE, _msgSender()) || hasRole(SCHEDULER_ROLE, _msgSender()), "Access denied");
        require(!_isRegisteredUser(params.userAddress), "User already registered");

        users[params.userAddress] = User({
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
            unStakeTime: uint64(block.timestamp + _unstakeDelay)
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

    function _removeNodeAddress(address node) internal {
        for (uint256 i = 0; i < nodeAddresses.length; i++) {
            if (nodeAddresses[i] == node) {
                nodeAddresses[i] = nodeAddresses[nodeAddresses.length - 1];
                nodeAddresses.pop();
                break;
            }
        }
    }

    function unstake() external override whenNotPaused {
        require(hasRole(TEE_NODE_ROLE, _msgSender()), "Not a TEE node");
        UnstakeRequest memory request = unstakeRequests[_msgSender()];
        require(
            request.unStakeTime < uint64(block.timestamp) && 
            request.unStakeTime > 0, "Unstake delay not passed");

        _removeNodeAddress(_msgSender());
        delete nodes[_msgSender()];
        delete unstakeRequests[_msgSender()];
        uint256 amount = _getTEEStakedAmount(_msgSender());
        (bool success, ) = _msgSender().call{value: amount}("");
        require(success, "ETH transfer failed");
        
        emit UnstakeCompleted(_msgSender(), amount);
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
        return _isRegisteredUser(user);
    }

    function _isRegisteredUser(address user) internal view returns (bool) {
        return users[user].registerTime > 0;
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
        uint64 timeout,
        address dataprovider,
        address node,
        uint256 rewardAmount
    ) external payable override whenNotPaused onlyRole(SCHEDULER_ROLE) {
        require(tasks[taskId].taskId == bytes32(0), "Task already exists");
        require(rewardAmount > 0 && rewardAmount <= _maxRewardAmount, "Invalid reward amount");
        require(timeout >= _minTaskTimeout, "Timeout too short");
        require(_isRegisteredUser(dataprovider), "Dataprovider not registered");
        require(hasRole(TEE_NODE_ROLE, node), "Invalid node");
        require(nodes[node].status == NodeStatus.RegisteredAndStaked, "Node not staked");

        tasks[taskId] = Task({
            taskId: taskId,
            dataprovider: dataprovider,
            creationTime: block.timestamp,
            timeoutTimestamp: block.timestamp + timeout,
            status: TaskStatus.Created,
            node: node,
            attestationProof: bytes(""),
            reward: rewardAmount
        });
        
        emit TaskRegistered(taskId, timeout, dataprovider, node, rewardAmount);
    }


    function submitProof(
        bytes32[] calldata taskIds,
        bytes32 merkleRoot,
        bytes calldata attestation
    ) external override whenNotPaused onlyRole(TEE_NODE_ROLE) {
        for(uint256 i = 0; i < taskIds.length; i++) {
            Task memory task = tasks[taskIds[i]];
            require(task.taskId != bytes32(0), "Task not found");
            require(_isTaskValid(task), "Task invalid");
            require(task.node == _msgSender(), "Not authorized node");
            
            task.status = TaskStatus.Completed;
            tasks[taskIds[i]] = task;
        }
        attestationProofs[merkleRoot] = AttestationProof({
            taskIds: taskIds,
            proof: attestation
        });
        emit ProofSubmitted(merkleRoot, taskIds, _msgSender());
    }

    function validateTask(
        bytes32[] calldata taskIds
    ) external override whenNotPaused onlyRole(VALIDATOR_ROLE) {
        for(uint256 i = 0; i < taskIds.length; i++) {
            Task memory task = tasks[taskIds[i]];
            require(task.taskId != bytes32(0), "Task not found");
            require(task.status == TaskStatus.Completed, "Task not completed");
            
            _setRewardStorage(task);
            emit TaskValidated(taskIds[i]);
        }
    }

    function rewardToken() external view override returns (address) {
        return _rewardToken;
    }

    function setRewardToken(address token) external override onlyRole(ADMIN_ROLE) {
        emit RewardTokenUpdated(_rewardToken, token);
        _rewardToken = token;
    }

    function setRewardTokenStatus(bool status) external override onlyRole(ADMIN_ROLE) {
        _isRewardTokenEnable = status;
    }

    function reward(address account, uint256 amount) external override whenNotPaused onlyRewardTokenEnable {
        require(rewardStorage[account] >= amount, "Insufficient reward balance");
        require(
            _msgSender() == account || 
            (nodes[account].nodeAddress != address(0) && _msgSender() == nodes[account].rewardAddress), 
            "Not authorized to claim reward"
        );
        
        rewardStorage[account] -= amount;
        
        if (_rewardToken == address(0)) {
            (bool success, ) = account.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(_rewardToken).safeTransfer(account, amount);
        }
        
        emit RewardClaimed(account, amount);
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

    function _setRewardStorage(Task memory task) internal {
        uint256 rewardPerParticipant = task.reward / 2;
        
        rewardStorage[task.dataprovider] += rewardPerParticipant;
        rewardStorage[nodes[task.node].rewardAddress] += rewardPerParticipant;
        
        emit RewardAllocated(task.taskId, task.dataprovider, task.node, rewardPerParticipant);
    }

    function getAttestationProof(bytes32[] calldata merkleRoot) external view returns (AttestationProof[] memory) {
        AttestationProof[] memory proofs = new AttestationProof[](merkleRoot.length);
        for(uint256 i = 0; i < merkleRoot.length; i++) {
            proofs[i] = attestationProofs[merkleRoot[i]];
        }
        return proofs;
    }

    function getNodeAddresses() external view returns (address[] memory) {
        return nodeAddresses;
    }

    function getRewardAmount(address account) external view returns (uint256) {
        return rewardStorage[account];
    }
} 
