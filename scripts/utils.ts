import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { TEEGovernance } from "../typechain-types/contracts/TEEGovernance";
import { ERC20Token } from "../typechain-types/contracts/mock/ERC20Token";
import { BytesLike, EventLog } from "ethers";
import { Address } from "../typechain-types";

async function deployTEEGovernance() {
    const TEEGovernance = await ethers.getContractFactory("TEEGovernance");
    const governance = await upgrades.deployProxy(TEEGovernance, [], { initializer: 'initialize' });
    await governance.waitForDeployment();
    return governance;
}

async function getUserSignature(params: any, signer: SignerWithAddress, governance: TEEGovernance) {
    const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
    const message = ethers.solidityPackedKeccak256(
        ["address", "bytes", "address", "uint256"],
        [
            params.userAddress,
            params.publicKey,
            await governance.getAddress(),
            chainId
        ]
    );
    return signer.signMessage(ethers.getBytes(message));
}

async function getNodeSignature(params: any, signer: SignerWithAddress, governance: TEEGovernance) {
    const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
    const message = ethers.solidityPackedKeccak256(
        ["address", "address", "bytes", "string", "uint256", "uint8", "address", "uint256"],
        [
            params.nodeAddress,
            params.rewardAddress,
            params.publicKey,
            params.apiEndpoint,
            params.registerTime,
            params.teeType,
            await governance.getAddress(),
            chainId
        ]
    );
    return signer.signMessage(ethers.getBytes(message));
}

async function getProofSignature(params: any, signer: SignerWithAddress, governance: TEEGovernance) {
    const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
    const message = ethers.solidityPackedKeccak256(
        ["bytes", "address", "uint256"],
        [params.proof, await governance.getAddress(), chainId]
    );
    return signer.signMessage(ethers.getBytes(message));
}

async function registerUser(user: string, governance: TEEGovernance, schedulerOrAdmin: SignerWithAddress) {
    const params = {
        userAddress: user,
        publicKey: "0x"
    };
    const tx = await governance.connect(schedulerOrAdmin).registerUser(params);
    await tx.wait();
}

async function getCurrentTime() {
    const block = await ethers.provider.getBlock('latest');
    return block!.timestamp;
}

async function mineXTimes(time: number, useSecond = false) {
    const seconds = useSecond ? time : time * 60;
    const currentTime = await getCurrentTime();
    await ethers.provider.send('evm_increaseTime', [currentTime]);
    await ethers.provider.send('evm_mine', [currentTime + seconds]);
}

async function registerNode(
    node: SignerWithAddress,
    governance: TEEGovernance,
    stakeAmount: bigint,
    options: {
        rewardAddress?: string,
        publicKey?: string,
        apiEndpoint?: string,
        teeType?: number
    } = {}
) {
    const params = {
        nodeAddress: node.address,
        rewardAddress: options.rewardAddress || node.address,
        publicKey: options.publicKey || "0x",
        apiEndpoint: options.apiEndpoint || "https://api.example.com",
        registerTime: Math.floor(Date.now() / 1000),
        teeType: options.teeType || 0
    };
    await governance.connect(node).registerNode(params, {
        value: stakeAmount
    });

    return params;
}

async function submitTaskProof(
    taskIds: string[],
    node: SignerWithAddress,
    governance: TEEGovernance,
    options: {
        attestation?: BytesLike
    } = {}
) {
    const attestation = options.attestation || ethers.randomBytes(32);

    const tx = await governance.connect(node).submitProof(taskIds, attestation);
    await tx.wait();

    return {
        attestation,
        tx: tx.hash
    };
}

async function registerTask(
    scheduler: SignerWithAddress,
    governance: TEEGovernance,
    options: {
        taskId?: string,
        timeout?: bigint,
        dataprovider?: string,
        node?: string,
        reward?: bigint
    } = {}
) {
    const taskId = options.taskId || ethers.keccak256(ethers.toUtf8Bytes("defaultTaskId"));
    const timeout = options.timeout || BigInt(3600);
    const reward = options.reward || ethers.parseEther("0.001");

    // console.log(`taskId: ${taskId}, timeout: ${timeout}, dataprovider: ${options.dataprovider}, node: ${options.node}, reward: ${reward}`);


    const registerTaskTx = await governance.connect(scheduler).registerTask(
        taskId,
        timeout,
        options.dataprovider!,
        options.node!,
        reward,
        { value: 0 }
    );
    await registerTaskTx.wait();

    return {
        taskId,
        timeout,
        reward,
        tx: registerTaskTx.hash
    };
}

async function validateTask(
    taskIds: string[],
    validator: SignerWithAddress,
    governance: TEEGovernance
) {
    const tx = await governance.connect(validator).validateTask(taskIds);
    await tx.wait();
    return tx.hash;
}

async function setupTaskWithProof(
    governance: TEEGovernance,
    scheduler: SignerWithAddress,
    node: SignerWithAddress,
    dataprovider: SignerWithAddress,
    validator: SignerWithAddress,
    options: {
        taskId?: string,
        timeout?: bigint,
        reward?: bigint,
        attestation?: BytesLike
    } = {}
) {
    const taskId = options.taskId || ethers.keccak256(ethers.randomBytes(32));
    const timeout = options.timeout || BigInt(3600);
    const reward = options.reward || ethers.parseEther("1");

    // Register task
    await registerTask(scheduler, governance, {
        taskId,
        timeout,
        node: node.address,
        dataprovider: dataprovider.address,
        reward
    });

    // Submit proof
    await submitTaskProof([taskId], node, governance, {
        attestation: options.attestation
    });

    // Validate task
    await validateTask([taskId], validator, governance);

    return {
        taskId,
        timeout,
        reward
    };
}

async function validateAndReward(
    taskIds: string[],
    validator: SignerWithAddress,
    governance: TEEGovernance
) {
    const tx = await governance.connect(validator).validateTask(taskIds);
    console.log(`tx: ${tx.hash}`);
    await tx.wait();
}

export async function grantRole(
    governance: TEEGovernance,
    owner: SignerWithAddress,
    role: string,
    account: string
) {
    return await governance.connect(owner).grantRole(role, account);
}

export async function grantAdminRole(
    governance: TEEGovernance,
    owner: SignerWithAddress,
    account: string
) {
    const adminRole = await governance.ADMIN_ROLE();
    return await grantRole(governance, owner, adminRole, account);
}

export async function grantValidatorRole(
    governance: TEEGovernance,
    owner: SignerWithAddress,
    account: string
) {
    const validatorRole = await governance.VALIDATOR_ROLE();
    return await grantRole(governance, owner, validatorRole, account);
}

export async function grantSchedulerRole(
    governance: TEEGovernance,
    owner: SignerWithAddress,
    account: string
) {
    const schedulerRole = await governance.SCHEDULER_ROLE();
    return await grantRole(governance, owner, schedulerRole, account);
}

export async function setupRoles(
    governance: TEEGovernance,
    owner: SignerWithAddress,
    options: {
        admin?: SignerWithAddress,
        scheduler?: SignerWithAddress,
        validator?: SignerWithAddress
    } = {}
) {
    const results = [];

    if (options.admin) {
        results.push(await grantAdminRole(governance, owner, options.admin.address));
    }

    if (options.scheduler) {
        results.push(await grantSchedulerRole(governance, owner, options.scheduler.address));
    }

    if (options.validator) {
        results.push(await grantValidatorRole(governance, owner, options.validator.address));
    }

    return results;
}

export async function deployERC20(owner: SignerWithAddress) {
    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const token = await ERC20Token.connect(owner).deploy("Mock Token", "MTK", 18);
    await token.waitForDeployment();
    return token;
}

export async function setRewardToken(
    governance: TEEGovernance,
    admin: SignerWithAddress,
    tokenAddress: string
) {
    const tx = await governance.connect(admin).setRewardToken(tokenAddress);
    await tx.wait();
    return tx.hash;
}


export {
    registerUser,
    registerNode,
    submitTaskProof,
    registerTask,
    setupTaskWithProof,
    mineXTimes,
    deployTEEGovernance,
    validateAndReward,
    validateTask
};