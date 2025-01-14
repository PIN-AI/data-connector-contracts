import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TEEGovernance } from "../typechain-types";
import { ERC20Token } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    // getProofSignature,
    registerUser,
    registerNode,
    submitTaskProof,
    registerTask,
    setupTaskWithProof,
    mineXTimes,
    deployTEEGovernance,
    grantRole,
    grantAdminRole,
    validateTask,
    grantSchedulerRole,
    setupRoles,
    deployERC20,
    setRewardToken,
} from "../scripts/utils";

describe("TEEGovernance", function () {
    enum TaskStatus {
        Invalid,
        Created,
        Running,
        Completed,
        Failed,
        Timeout
    }

    let STAKE_AMOUNT = BigInt(0);

    async function setupTaskEnvironment(
        governance: TEEGovernance,
        owner: SignerWithAddress,
        node: SignerWithAddress,
        scheduler: SignerWithAddress,
        dataprovider: SignerWithAddress
    ) {
        const schedulerRole = await governance.SCHEDULER_ROLE();
        await governance.connect(owner).grantRole(schedulerRole, scheduler.address);

        await registerUser(dataprovider.address, governance, scheduler);

        const nodeParams = {
            nodeAddress: node.address,
            rewardAddress: node.address,
            publicKey: "0x",
            apiEndpoint: "https://api.example.com",
            registerTime: Math.floor(Date.now() / 1000),
            teeType: 0
        };
        const tx2 = await governance.connect(node).registerNode(nodeParams, {
            value: STAKE_AMOUNT
        });
        await tx2.wait();
    }


    async function deployTEERegistryFixture() {
        const [owner, admin, validator, node1, node2, user1, user2, scheduler] = await ethers.getSigners();

        const governance = await deployTEEGovernance();

        // Setup initial roles
        await setupRoles(governance, owner, {
            admin,
            scheduler,
            validator
        });

        STAKE_AMOUNT = await governance.getTEEStakeThr();

        return {
            governance,
            owner,
            admin,
            validator,
            node1,
            node2,
            user1,
            user2,
            scheduler
        };
    }

    describe("Deployability", function () {
        it("Should set the right owner", async function () {
            const { governance, owner } = await loadFixture(deployTEERegistryFixture);
            const ownerRole = await governance.OWNER_ROLE();
            expect(await governance.hasRole(ownerRole, owner.address)).to.be.true;
        });

        it("Should set the right admin", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);
            const adminRole = await governance.ADMIN_ROLE();
            expect(await governance.hasRole(adminRole, admin.address)).to.be.true;
        });
    });

    describe("Access Control", function () {
        it("Should allow owner to grant roles", async function () {
            const { governance, owner, user1 } = await loadFixture(deployTEERegistryFixture);

            await grantAdminRole(governance, owner, user1.address);

            const adminRole = await governance.ADMIN_ROLE();
            expect(await governance.hasRole(adminRole, user1.address)).to.be.true;
        });

        it("Should not allow non-owner to grant roles", async function () {
            const { governance, user1, user2 } = await loadFixture(deployTEERegistryFixture);
            const adminRole = await governance.ADMIN_ROLE();

            await expect(
                grantRole(governance, user1, adminRole, user2.address)
            ).to.be.reverted;
        });
    });

    describe("Node Registration", function () {
        it("Should register a node successfully", async function () {
            const { governance, node1 } = await loadFixture(deployTEERegistryFixture);

            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };

            await expect(governance.connect(node1).registerNode(params, {
                value: STAKE_AMOUNT
            })).to.emit(governance, "NodeRegistered")
                .withArgs(
                    node1.address,
                    node1.address,
                    node1.address,
                    STAKE_AMOUNT,
                    "0x",
                    "https://api.example.com",
                    0
                );
        });
    });

    describe("User Registration", function () {
        it("Should register user", async function () {
            const { governance, owner } = await loadFixture(deployTEERegistryFixture);
            const params = {
                userAddress: owner.address,
                publicKey: "0x"
            };

            await governance.connect(owner).registerUser(params);
            expect(await governance.isRegisteredUser(owner.address)).to.be.true;
        });

        it("Should not register same user twice", async function () {
            const { governance, owner } = await loadFixture(deployTEERegistryFixture);
            const params = {
                userAddress: owner.address,
                publicKey: "0x"
            };

            await governance.connect(owner).registerUser(params);
            await expect(
                governance.connect(owner).registerUser(params)
            ).to.be.revertedWith("User already registered");
        });
    });

    describe("Pausable", function () {
        it("Should allow admin to pause and unpause", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);

            await governance.connect(admin).pause();
            expect(await governance.paused()).to.be.true;

            await governance.connect(admin).unpause();
            expect(await governance.paused()).to.be.false;
        });

        it("Should not allow operations when paused", async function () {
            const { governance, admin, user1 } = await loadFixture(deployTEERegistryFixture);

            await governance.connect(admin).pause();

            const params = {
                userAddress: user1.address,
                publicKey: "0x"
            };

            // error: EnforcedPause()
            await expect(
                governance.connect(user1).registerUser(params)
            ).to.be.reverted;
        });
    });

    describe("Staking", function () {
        it("Should allow node to stake during registration", async function () {
            const { governance, node1 } = await loadFixture(deployTEERegistryFixture);

            await registerNode(node1, governance, STAKE_AMOUNT);

            const node = await governance.nodes(node1.address);
            expect(node.stakeAmount).to.equal(STAKE_AMOUNT);
        });

        it("Should return stake amount on successful unstake", async function () {
            const { governance, node1 } = await loadFixture(deployTEERegistryFixture);

            // Register and stake
            await registerNode(node1, governance, STAKE_AMOUNT);

            // Request unstake
            await governance.connect(node1).unstakeRequest();

            // Wait for delay
            const unstakeDelay = await governance.getUnstakeDelay();
            await mineXTimes(Number(unstakeDelay) + 1, true);

            // Get initial balance and stake amount
            const initialBalance = await ethers.provider.getBalance(node1.address);
            const stakeAmount = await governance.getStakedAmount(node1.address);

            // Perform unstake
            const unstakeTx = await governance.connect(node1).unstake();
            const receipt = await unstakeTx.wait();

            // Calculate gas cost
            const gasUsed = receipt!.gasUsed;
            const gasPrice = unstakeTx.gasPrice;
            const gasCost = gasUsed * gasPrice;

            // Get final balance
            const finalBalance = await ethers.provider.getBalance(node1.address);

            // check stake amount is zero
            expect(await governance.getStakedAmount(node1.address)).to.equal(0);
        });

        it("Should allow admin to slash active node", async function () {
            const { governance, admin, node1 } = await loadFixture(deployTEERegistryFixture);

            // Register and stake
            await registerNode(node1, governance, STAKE_AMOUNT);

            // Slash half amount
            await governance.connect(admin).slash(node1.address, STAKE_AMOUNT / 2n);
            const node = await governance.nodes(node1.address);
            expect(node.status).to.equal(2); // Still RegisteredAndStaked

            // Slash remaining amount
            await governance.connect(admin).slash(node1.address, STAKE_AMOUNT / 2n);
            const nodeAfterFullSlash = await governance.nodes(node1.address);
            expect(nodeAfterFullSlash.status).to.equal(0); // Suspended
        });
    });

    describe("Node Management", function () {
        it("Should register different types of nodes", async function () {
            const { governance } = await loadFixture(deployTEERegistryFixture);
            const nodes = await ethers.getSigners();
            const testNodes = nodes.slice(10, 15);

            for (let teeType = 0; teeType < 5; teeType++) {
                const node = testNodes[teeType];
                const params = {
                    nodeAddress: node.address,
                    rewardAddress: node.address,
                    publicKey: "0x",
                    apiEndpoint: "https://api.example.com",
                    registerTime: Math.floor(Date.now() / 1000),
                    teeType: teeType
                };

                await governance.connect(node).registerNode(params, {
                    value: STAKE_AMOUNT
                });

                const registeredNode = await governance.nodes(node.address);
                expect(registeredNode.teeType).to.equal(teeType);
            }
        });

        it("Should allow admin to revoke inactive node", async function () {
            const { governance, admin, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };

            await governance.connect(node1).registerNode(params, {
                value: STAKE_AMOUNT
            });

            await governance.connect(admin).revokeNodeRole(node1.address);
            expect(await governance.isRegisteredNode(node1.address)).to.be.false;
        });
    });

    // describe("Slashing", function () {
    //     it("Should allow admin to slash active node", async function () {
    //         const { governance, admin, signer, node1 } = await loadFixture(deployTEERegistryFixture);
    //         const params = {
    //             nodeAddress: node1.address,
    //             rewardAddress: node1.address,
    //             publicKey: "0x",
    //             apiEndpoint: "https://api.example.com",
    //             registerTime: Math.floor(Date.now() / 1000),
    //             teeType: 0
    //         };
    //         const attestation = await getNodeSignature(params, signer, governance);

    //         // Register and stake
    //         await governance.connect(node1).registerNode(params, attestation);
    //         await governance.connect(node1).stake(STAKE_AMOUNT, node1.address);

    //         // Slash half amount
    //         await governance.connect(admin).slash(node1.address, STAKE_AMOUNT / 2n);
    //         const node = await governance.nodes(node1.address);
    //         expect(node.status).to.equal(4); // Still Active

    //         // Slash full amount
    //         await governance.connect(admin).slash(node1.address, STAKE_AMOUNT);
    //         const nodeAfterFullSlash = await governance.nodes(node1.address);
    //         expect(nodeAfterFullSlash.status).to.equal(0); // Suspended
    //     });
    // });

    describe("Configuration Management", function () {
        it("Should allow admin to update stake amount", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);
            const newAmount = ethers.parseEther("20");

            await governance.connect(admin).setStakeAmount(newAmount);
            expect(await governance.getTEEStakeThr()).to.equal(newAmount);
        });

        it("Should allow admin to update unstake delay", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);
            const newDelay = 14 * 24 * 60 * 60; // 14 days

            await governance.connect(admin).setUnstakeDelay(newDelay);
            expect(await governance.getUnstakeDelay()).to.equal(newDelay);
        });

        it("Should not allow non-admin to update configuration", async function () {
            const { governance, user1 } = await loadFixture(deployTEERegistryFixture);
            const newAmount = ethers.parseEther("20");

            await expect(
                governance.connect(user1).setStakeAmount(newAmount)
            ).to.be.reverted;
        });
    });

    describe("Owner Management", function () {
        it("Should allow owner to transfer ownership", async function () {
            const { governance, owner, user1 } = await loadFixture(deployTEERegistryFixture);
            const ownerRole = await governance.OWNER_ROLE();

            await governance.connect(owner).transferOwnership(user1.address);

            expect(await governance.hasRole(ownerRole, user1.address)).to.be.true;
            expect(await governance.hasRole(ownerRole, owner.address)).to.be.false;
        });
    });

    describe("Task Management", function () {
        it("Should allow scheduler to register task with specified node", async function () {
            const { governance, owner, node1, user1 } = await loadFixture(deployTEERegistryFixture);
            const scheduler = owner;
            // 设置环境
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // 使用 scheduler 注册任务
            await expect(
                governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user1.address,
                    node1.address,
                    reward,
                    { value: reward }
                )
            ).to.emit(governance, "TaskRegistered");
        });

        it("Should allow specified node to submit proof and receive reward", async function () {
            const { governance, owner, node1, user1 } = await loadFixture(deployTEERegistryFixture);
            const scheduler = owner;
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            // 注册任务
            const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("2");

            await governance.connect(scheduler).registerTask(
                taskId,
                timeout,
                user1.address,
                node1.address,
                reward,
                { value: reward }
            );

            // 提交证明
            const attestation = ethers.randomBytes(32);
            await expect(
                governance.connect(node1).submitProof([taskId], attestation)
            ).to.emit(governance, "ProofSubmitted");
        });

        it("Should not allow unauthorized node to submit proof", async function () {
            const { governance, owner, node1, node2, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            const dataprovider = user2;
            await setupTaskEnvironment(governance, owner, node1, scheduler, dataprovider);
            await setupTaskEnvironment(governance, owner, node2, scheduler, user1);

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // Register task with node1
            await governance.connect(scheduler).registerTask(
                taskId,
                timeout,
                dataprovider.address,
                node1.address,
                reward,
                { value: reward }
            );


            // Try to submit proof with node2
            const proofData = ethers.randomBytes(32);
            await expect(
                governance.connect(node2).submitProof([taskId], proofData)
            ).to.be.revertedWith("Not authorized node");
        });

        it("Should emit RewardAllocated event on proof submission", async function () {
            const { governance, owner, node1, user1, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("2");

            await governance.connect(scheduler).registerTask(
                taskId,
                timeout,
                user1.address,
                node1.address,
                reward,
                { value: reward }
            );

            const proofData = ethers.randomBytes(32);

            await expect(governance.connect(node1).submitProof([taskId], proofData))
                .to.emit(governance, "ProofSubmitted")
            // .withArgs(taskId, user2.address, node1.address, reward / 2n);
        });

        it("Should not allow non-scheduler to register task", async function () {
            const { governance, owner, node1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            try {
                await registerTask(user2, governance, {
                    dataprovider: user2.address,
                    node: node1.address
                });
                throw new Error("Test should have failed");
            } catch (error: any) {
                const errorMessage = error.message;
                if (!errorMessage.includes("AccessControlUnauthorizedAccount")) {
                    throw new Error("Unexpected error: " + errorMessage);
                }
            }
        });

        it("Should not allow registering task with unregistered node", async function () {
            const { governance, owner, node1, node2, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            await expect(
                registerTask(scheduler, governance, {
                    dataprovider: user1.address,
                    node: node2.address
                })
            ).to.be.revertedWith("Invalid node");
        });

        it("Should not allow registering duplicate task", async function () {
            const { governance, owner, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const taskId = ethers.keccak256(ethers.randomBytes(32));

            // Register first task
            await registerTask(scheduler, governance, {
                taskId,
                dataprovider: user2.address,
                node: node1.address
            });

            // Try to register duplicate task
            await expect(
                registerTask(scheduler, governance, {
                    taskId,
                    dataprovider: user2.address,
                    node: node1.address
                })
            ).to.be.revertedWith("Task already exists");
        });

        it("Should not allow submitting proof after timeout", async function () {
            const { governance, owner, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const { taskId } = await registerTask(scheduler, governance, {
                timeout: BigInt(3600),
                dataprovider: user2.address,
                node: node1.address
            });

            // Wait for timeout
            await mineXTimes(7200, true);

            await expect(
                submitTaskProof([taskId], node1, governance)
            ).to.be.revertedWith("Task invalid");
        });

        it("Should not allow submitting proof multiple times", async function () {
            const { governance, owner, node1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const { taskId } = await registerTask(scheduler, governance, {
                dataprovider: user2.address,
                node: node1.address
            });

            // Submit first proof
            await submitTaskProof([taskId], node1, governance);

            // Try to submit second proof
            await expect(
                submitTaskProof([taskId], node1, governance)
            ).to.be.revertedWith("Task invalid");
        });

        it("Should accumulate rewards from multiple tasks", async function () {
            const { governance, owner, validator, node1, node2, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);
            await setupTaskEnvironment(governance, owner, node2, scheduler, user2);
            const reward = ethers.parseEther("2");
            const expectedReward = reward / 2n;

            // Complete first task
            await setupTaskWithProof(governance, scheduler, node1, user1, validator, {
                reward
            });

            // Complete second task
            await setupTaskWithProof(governance, scheduler, node2, user2, validator, {
                reward
            });

            // Check accumulated rewards
            expect(await governance.rewardStorage(node1.address)).to.equal(expectedReward);
            expect(await governance.rewardStorage(user2.address)).to.equal(expectedReward);
        });

        it("Should verify task status transitions", async function () {
            const { governance, owner, node1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            // Register task and check initial status
            const { taskId } = await registerTask(scheduler, governance, {
                dataprovider: user2.address,
                node: node1.address
            });

            let task = await governance.tasks(taskId);
            expect(task.status).to.equal(TaskStatus.Created);

            // Submit proof and check completed status
            await submitTaskProof([taskId], node1, governance);

            task = await governance.tasks(taskId);
            expect(task.status).to.equal(TaskStatus.Completed);
        });

        it("Should not allow registering task with reward exceeding maximum", async function () {
            const { governance, owner, node1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const maxReward = await governance.getMaxRewardAmount();
            const reward = maxReward + 1n;

            await expect(
                registerTask(scheduler, governance, {
                    dataprovider: user2.address,
                    node: node1.address,
                    reward
                })
            ).to.be.revertedWith("Invalid reward amount");
        });

        it("Should allow node to submit proof for multiple tasks", async function () {
            const { governance, owner, validator, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);

            // Setup validator role first
            const validatorRole = await governance.VALIDATOR_ROLE();
            await governance.connect(owner).grantRole(validatorRole, validator.address);

            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // Register tasks
            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user2.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // Submit proofs
            const attestation = ethers.randomBytes(32);

            await expect(governance.connect(node1).submitProof(taskIds, attestation))
                .to.emit(governance, "ProofSubmitted");

            // Validate tasks with validator
            await expect(governance.connect(validator).validateTask(taskIds))
                .to.emit(governance, "TaskValidated");

            // Verify task status
            for (const taskId of taskIds) {
                const task = await governance.tasks(taskId);
                expect(task.status).to.equal(TaskStatus.Completed);
            }
        });

        it("Should revert when non-validator tries to validate task", async function () {
            const { governance, owner, validator, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);

            // Setup validator role
            const validatorRole = await governance.VALIDATOR_ROLE();
            await governance.connect(owner).grantRole(validatorRole, validator.address);

            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // Register task
            await governance.connect(scheduler).registerTask(
                taskId,
                timeout,
                user2.address,
                node1.address,
                reward,
                { value: reward }
            );

            // Submit proof
            const attestation = ethers.randomBytes(32);
            await governance.connect(node1).submitProof([taskId], attestation);

            // Try to validate with non-validator (user1)
            await expect(
                governance.connect(user1).validateTask([taskId])
            ).to.be.revertedWithCustomError(
                governance,
                "AccessControlUnauthorizedAccount"
            );
        });

        it("Should not allow registering task with reward exceeding maximum", async function () {
            const { governance, owner, node1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const taskId = ethers.keccak256(ethers.toUtf8Bytes("task1"));
            const timeout = BigInt(3600);
            const maxReward = await governance.getMaxRewardAmount();
            const reward = maxReward + BigInt(1);

            await expect(
                governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user2.address,
                    node1.address,
                    reward,
                    { value: reward }
                )
            ).to.be.revertedWith("Invalid reward amount");
        });

        it("Should revert when submitting proof for already completed tasks in batch", async function () {
            const { governance, owner, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);
            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            // Register tasks
            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user2.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // Submit proofs first time
            const attestation = ethers.randomBytes(32);
            await governance.connect(node1).submitProof(taskIds, attestation);

            // Try to submit proofs again
            await expect(
                governance.connect(node1).submitProof(taskIds, attestation)
            ).to.be.revertedWith("Task invalid");
        });
    });

    describe("Reward Management", function () {
        it("Should revert on insufficient reward balance", async function () {
            const { governance, node1 } = await loadFixture(deployTEERegistryFixture);
            const amount = ethers.parseEther("1");

            await expect(
                governance.connect(node1).reward(node1.address, amount)
            ).to.be.revertedWith("Insufficient reward balance");
        });
    });

    describe("Proof Submission", function () {
        it("Should allow node to submit proof for multiple tasks", async function () {
            const { governance, owner, validator, node1, user1, user2, scheduler } = await loadFixture(deployTEERegistryFixture);

            // Setup validator role first
            const validatorRole = await governance.VALIDATOR_ROLE();
            await governance.connect(owner).grantRole(validatorRole, validator.address);

            await setupTaskEnvironment(governance, owner, node1, scheduler, user2);

            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // Register tasks
            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user2.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // Submit proofs
            const attestation = ethers.randomBytes(32);

            await expect(governance.connect(node1).submitProof(taskIds, attestation))
                .to.emit(governance, "ProofSubmitted");

            // Validate tasks with validator
            await expect(governance.connect(validator).validateTask(taskIds))
                .to.emit(governance, "TaskValidated");

            // Verify task status
            for (const taskId of taskIds) {
                const task = await governance.tasks(taskId);
                expect(task.status).to.equal(TaskStatus.Completed);
            }
        });

        // ... other test cases ...
    });

    describe("Batch Proof Submission", function () {
        it("Should submit proofs for multiple tasks successfully", async function () {
            const { governance, owner, node1, user1 } = await loadFixture(deployTEERegistryFixture);
            const scheduler = owner;
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // Register tasks
            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user1.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // Submit proofs
            const attestation = ethers.randomBytes(32);
            await expect(
                governance.connect(node1).submitProof(taskIds, attestation)
            ).to.emit(governance, "ProofSubmitted");

            // Verify all tasks are completed
            for (const taskId of taskIds) {
                const task = await governance.tasks(taskId);
                expect(task.status).to.equal(TaskStatus.Completed);
            }
        });

        it("Should revert when submitting proof with non-existent task in batch", async function () {
            const { governance, owner, scheduler, node1, user1 } = await loadFixture(deployTEERegistryFixture);

            // 设置环境
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            const validTaskId = ethers.keccak256(ethers.toUtf8Bytes("valid"));
            const invalidTaskId = ethers.keccak256(ethers.toUtf8Bytes("invalid"));
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // 只注册有效任务
            await governance.connect(scheduler).registerTask(
                validTaskId,
                timeout,
                user1.address,
                node1.address,
                reward,
                { value: reward }
            );

            // 尝试提交包含无效任务的证明
            const attestation = ethers.randomBytes(32);
            await expect(
                governance.connect(node1).submitProof([validTaskId, invalidTaskId], attestation)
            ).to.be.revertedWith("Task not found");
        });

        it("Should revert when submitting proof for timed out tasks in batch", async function () {
            const { governance, owner, scheduler, node1, user1 } = await loadFixture(deployTEERegistryFixture);

            // 设置环境
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            // 注册任务
            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user1.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // 等待任务超时
            await mineXTimes(Number(timeout) + 1, true);

            // 尝试为超时任务提交证明
            const attestation = ethers.randomBytes(32);
            await expect(
                governance.connect(node1).submitProof(taskIds, attestation)
            ).to.be.revertedWith("Task invalid");
        });

        it("Should revert when submitting proof for already completed tasks in batch", async function () {
            const { governance, owner, node1, user1 } = await loadFixture(deployTEERegistryFixture);
            const scheduler = owner;
            await setupTaskEnvironment(governance, owner, node1, scheduler, user1);

            // Register tasks
            const taskIds = [
                ethers.keccak256(ethers.toUtf8Bytes("task1")),
                ethers.keccak256(ethers.toUtf8Bytes("task2"))
            ];
            const timeout = BigInt(3600);
            const reward = ethers.parseEther("1");

            for (const taskId of taskIds) {
                await governance.connect(scheduler).registerTask(
                    taskId,
                    timeout,
                    user1.address,
                    node1.address,
                    reward,
                    { value: reward }
                );
            }

            // Submit proofs first time
            const attestation = ethers.randomBytes(32);
            await governance.connect(node1).submitProof(taskIds, attestation);

            // Try to submit proofs again
            await expect(
                governance.connect(node1).submitProof(taskIds, attestation)
            ).to.be.revertedWith("Task invalid");
        });
    });

    describe("ERC20 Rewards", function () {
        it("Should set reward token correctly", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);
            const token = await deployERC20(admin);

            await expect(governance.connect(admin).setRewardToken(await token.getAddress()))
                .to.emit(governance, "RewardTokenUpdated")
                .withArgs(ethers.ZeroAddress, await token.getAddress());

            expect(await governance.rewardToken()).to.equal(await token.getAddress());
        });

        it("Should register task with ERC20 token reward", async function () {
            const { governance, admin, scheduler, node1, user1 } = await loadFixture(deployTEERegistryFixture);
            const token = await deployERC20(admin);

            // transfer token to governance
            await token.transfer(await governance.getAddress(), ethers.parseEther("10000"));

            // 设置ERC20为奖励代币
            await setRewardToken(governance, admin, await token.getAddress());

            // 设置环境
            await setupTaskEnvironment(governance, admin, node1, scheduler, user1);

            // 给scheduler铸造代币
            const reward = ethers.parseEther("1");

            const taskId = ethers.keccak256(ethers.randomBytes(32));

            // 注册任务
            await expect(registerTask(scheduler, governance, {
                taskId,
                node: node1.address,
                dataprovider: user1.address,
                reward
            })).to.be.not.reverted;
        });

        it("Should claim ERC20 rewards after task completion", async function () {
            const { governance, admin, scheduler, node1, user1, validator } = await loadFixture(deployTEERegistryFixture);
            const token = await deployERC20(admin);

            // transfer token to governance
            await token.transfer(await governance.getAddress(), ethers.parseEther("10000"));

            // 设置ERC20为奖励代币
            await setRewardToken(governance, admin, await token.getAddress());

            // 设置环境
            await setupTaskEnvironment(governance, admin, node1, scheduler, user1);

            // 给scheduler铸造代币
            const reward = ethers.parseEther("1");


            // 完成任务流程
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            await registerTask(scheduler, governance, {
                taskId,
                node: node1.address,
                dataprovider: user1.address,
                reward
            });

            await submitTaskProof([taskId], node1, governance);
            await validateTask([taskId], validator, governance);

            // 检查奖励分配
            const rewardPerParticipant = reward / BigInt(2);
            expect(await governance.rewardStorage(user1.address)).to.equal(rewardPerParticipant);
            expect(await governance.rewardStorage(node1.address)).to.equal(rewardPerParticipant);

            // 提取奖励
            const beforeBalance = await token.balanceOf(user1.address);
            await expect(governance.connect(node1).reward(node1.address, rewardPerParticipant))
                .to.emit(governance, "RewardClaimed")
                .withArgs(node1.address, rewardPerParticipant);
            expect(await token.balanceOf(node1.address))
                .to.equal(beforeBalance + rewardPerParticipant);
        });

        it("Should allow admin to withdraw ERC20 tokens", async function () {
            const { governance, admin } = await loadFixture(deployTEERegistryFixture);
            const token = await deployERC20(admin);
            // transfer token to governance
            await token.transfer(await governance.getAddress(), ethers.parseEther("10000"));

            const amount = ethers.parseEther("1");

            // 管理员提取代币
            const receiver = ethers.Wallet.createRandom().address;
            await expect(governance.connect(admin).withdrawToken(
                await token.getAddress(),
                receiver,
                amount
            )).to.changeTokenBalances(
                token,
                [governance, receiver],
                [-amount, amount]
            );
        });

        it("Should revert when claiming more rewards than available", async function () {
            const { governance, admin, scheduler, node1, user1, validator } = await loadFixture(deployTEERegistryFixture);
            const token = await deployERC20(admin);

            // transfer token to governance
            await token.transfer(await governance.getAddress(), ethers.parseEther("10000"));

            await setRewardToken(governance, admin, await token.getAddress());
            await setupTaskEnvironment(governance, admin, node1, scheduler, user1);

            const reward = ethers.parseEther("1");

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            await registerTask(scheduler, governance, {
                taskId,
                node: node1.address,
                dataprovider: user1.address,
                reward
            });

            await submitTaskProof([taskId], node1, governance);
            await validateTask([taskId], validator, governance);

            // 尝试提取超过可用余额的奖励
            await expect(governance.connect(user1).reward(
                user1.address,
                reward
            )).to.be.revertedWith("Insufficient reward balance");
        });
    });
}); 