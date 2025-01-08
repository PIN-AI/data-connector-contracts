import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TEEGovernance } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { EventLog } from "ethers";

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

    async function deployTEERegistryFixture() {
        const [owner, admin, signer, node1, node2, user1, user2] = await ethers.getSigners();

        const TEEGovernance = await ethers.getContractFactory("TEEGovernance");
        const governance = await upgrades.deployProxy(TEEGovernance, [], { initializer: 'initialize' });
        await governance.waitForDeployment();

        const adminRole = await governance.ADMIN_ROLE();
        const signerRole = await governance.SIGNER_ROLE();

        await governance.grantRole(adminRole, admin.address);
        await governance.grantRole(signerRole, signer.address);

        STAKE_AMOUNT = BigInt(await governance.getTEEStakeThr());

        // Set initial max reward amount
        const initialMaxReward = ethers.parseEther("100");
        await governance.connect(owner).setMaxRewardAmount(initialMaxReward);

        return { governance, owner, admin, signer, node1, node2, user1, user2 };
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

    async function getProofHash(params: any, signer: SignerWithAddress, governance: TEEGovernance) {
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
        const message = ethers.solidityPackedKeccak256(
            ["bytes32", "bytes32", "address", "address", "uint256"],
            [
                params.taskId,
                params.dataHash,
                params.nodeAddress,
                await governance.getAddress(),
                chainId
            ]
        );
        return signer.signMessage(ethers.getBytes(message));
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
            const adminRole = await governance.ADMIN_ROLE();
            await governance.connect(owner).grantRole(adminRole, user1.address);
            expect(await governance.hasRole(adminRole, user1.address)).to.be.true;
        });

        it("Should not allow non-owner to grant roles", async function () {
            const { governance, user1, user2 } = await loadFixture(deployTEERegistryFixture);
            const adminRole = await governance.ADMIN_ROLE();
            // Error: VM Exception while processing transaction: reverted with custom error 'AccessControlUnauthorizedAccount("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "0xb19546dff01e856fb3f010c267a7b1c60363cf8a4664e21cc89c26224620214e")'
            await expect(
                governance.connect(user1).grantRole(adminRole, user2.address)
            ).to.be.reverted;
        });
    });

    describe("Node Registration", function () {
        it("Should register node with valid attestation and stake", async function () {
            const { governance, owner, signer, node1 } = await loadFixture(deployTEERegistryFixture);

            // Grant SIGNER_ROLE to signer
            const signerRole = await governance.SIGNER_ROLE();
            await governance.connect(owner).grantRole(signerRole, signer.address);

            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register with stake
            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });

            const node = await governance.nodes(node1.address);
            expect(node.nodeAddress).to.equal(node1.address);
            expect(node.status).to.equal(2); // RegisteredAndStaked
            expect(node.stakeAmount).to.equal(STAKE_AMOUNT);
            expect(await governance.hasRole(await governance.TEE_NODE_ROLE(), node1.address)).to.be.true;
        });

        it("Should not register node without sufficient stake", async function () {
            const { governance, owner, signer, node1 } = await loadFixture(deployTEERegistryFixture);

            const signerRole = await governance.SIGNER_ROLE();
            await governance.connect(owner).grantRole(signerRole, signer.address);

            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            const insufficientStake = STAKE_AMOUNT / 2n;
            await expect(
                governance.connect(node1).registerNode(params, attestation, {
                    value: insufficientStake
                })
            ).to.be.revertedWith("Insufficient stake amount");
        });

        it("Should not register node with invalid attestation", async function () {
            const { governance, node1, node2 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, node2, governance);

            await expect(
                governance.connect(node1).registerNode(params, attestation, {
                    value: STAKE_AMOUNT
                })
            ).to.be.revertedWith("Invalid attestation signer");
        });

        it("Should not register same node twice", async function () {
            const { governance, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });
            await expect(
                governance.connect(node1).registerNode(params, attestation, {
                    value: STAKE_AMOUNT
                })
            ).to.be.revertedWith("Node already registered");
        });
    });

    describe("User Registration", function () {
        it("Should register user", async function () {
            const { governance, signer, user1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                userAddress: user1.address,
                publicKey: "0x"
            };
            const credentials = await getUserSignature(params, signer, governance);

            await governance.connect(user1).registerUser(params, credentials);
            expect(await governance.isRegisteredUser(user1.address)).to.be.true;
        });

        it("Should not register same user twice", async function () {
            const { governance, signer, user1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                userAddress: user1.address,
                publicKey: "0x"
            };
            const credentials = await getUserSignature(params, signer, governance);

            await governance.connect(user1).registerUser(params, credentials);
            await expect(
                governance.connect(user1).registerUser(params, credentials)
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
            const credentials = await getUserSignature(params, user1, governance);

            // error: EnforcedPause()
            await expect(
                governance.connect(user1).registerUser(params, credentials)
            ).to.be.reverted;
        });
    });

    describe("Staking", function () {
        it.skip("Should allow node to stake through direct ETH transfer", async function () {
            const { governance, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register node first
            await governance.connect(node1).registerNode(params, attestation);

            // Send ETH directly
            await node1.sendTransaction({
                to: await governance.getAddress(),
                value: STAKE_AMOUNT
            });

            const node = await governance.nodes(node1.address);
            expect(node.stakeAmount).to.equal(STAKE_AMOUNT);
        });

        it("Should allow node to stake during registration", async function () {
            const { governance, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register and stake
            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });

            const node = await governance.nodes(node1.address);
            expect(node.stakeAmount).to.equal(STAKE_AMOUNT);
            expect(node.status).to.equal(2); // Active
        });

        it("Should not allow unstake before delay", async function () {
            const { governance, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register and stake to become active
            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });
            await expect(
                governance.connect(node1).unstake()
            ).to.be.revertedWith("Unstake delay not passed");
        });

        it("Should return stake amount on successful unstake", async function () {
            const { governance, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register and stake to become active
            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });

            // Request unstake
            await governance.connect(node1).unstakeRequest();

            const unstakeRequests = await governance.unstakeRequests(node1.address);
            expect(unstakeRequests.unStakeTime).to.be.greaterThan(0);

            const unstakeDelay = await governance.getUnstakeDelay();
            const timeBefore = await getCurrentTime();
            await mineXTimes(Number(unstakeDelay) + 1, true);
            const timeAfter = await getCurrentTime();
            expect(timeAfter - timeBefore).to.be.greaterThan(Number(unstakeDelay));
            // Check ETH balance before unstake
            const balanceBefore = await ethers.provider.getBalance(node1.address);

            // Unstake
            await governance.connect(node1).unstake();

            // Check ETH balance after unstake
            const balanceAfter = await ethers.provider.getBalance(node1.address);
            expect(balanceAfter - balanceBefore).to.be.closeTo(
                STAKE_AMOUNT,
                ethers.parseEther("0.01") // Allow for gas costs
            );
        });

        it("Should allow admin to slash active node", async function () {
            const { governance, admin, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            // Register and stake to become active
            await governance.connect(node1).registerNode(params, attestation, {
                value: STAKE_AMOUNT
            });

            // Slash half amount
            await governance.connect(admin).slash(node1.address, STAKE_AMOUNT / 2n);
            const node = await governance.nodes(node1.address);
            expect(node.status).to.equal(2); // Still Active

            // Slash remaining amount
            await governance.connect(admin).slash(node1.address, STAKE_AMOUNT / 2n);
            const nodeAfterFullSlash = await governance.nodes(node1.address);
            expect(nodeAfterFullSlash.status).to.equal(0); // Suspended
        });
    });

    describe("Node Management", function () {
        it("Should register different types of nodes", async function () {
            const { governance, signer } = await loadFixture(deployTEERegistryFixture);
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
                const attestation = await getNodeSignature(params, signer, governance);

                await governance.connect(node).registerNode(params, attestation, {
                    value: STAKE_AMOUNT
                });

                const registeredNode = await governance.nodes(node.address);
                expect(registeredNode.teeType).to.equal(teeType);
            }
        });

        it("Should allow admin to revoke inactive node", async function () {
            const { governance, admin, signer, node1 } = await loadFixture(deployTEERegistryFixture);
            const params = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(params, signer, governance);

            await governance.connect(node1).registerNode(params, attestation, {
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
        it("Should allow scheduler to register task", async function () {
            const { governance, owner, admin, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Grant SCHEDULER_ROLE to user1
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const reward = ethers.parseEther("1");

            const tx = await governance.connect(user1).registerTask(
                taskId,
                dataHash,
                user2.address,
                reward,
                { value: reward } // Add value to cover reward
            );

            const receipt = await tx.wait();
            const taskRegisteredEvent = receipt?.logs.find(
                log => log instanceof EventLog && log.eventName === 'TaskRegistered'
            ) as EventLog;

            expect(taskRegisteredEvent.args[0]).to.equal(taskId);
            expect(taskRegisteredEvent.args[1]).to.equal(dataHash);
            expect(taskRegisteredEvent.args[2]).to.equal(user2.address);
            expect(taskRegisteredEvent.args[3]).to.equal(reward);

            const task = await governance.tasks(taskId);
            expect(task.taskId).to.equal(taskId);
            expect(task.dataprovider).to.equal(user2.address);
            expect(task.status).to.equal(1); // Created
            expect(task.reward).to.equal(reward);
        });

        it("Should allow TEE node to submit proof and update status", async function () {
            const { governance, owner, admin, signer, node1, user1, user2 } = await loadFixture(deployTEERegistryFixture);
            const reward = ethers.parseEther("1");

            // Send reward to contract
            await admin.sendTransaction({
                to: await governance.getAddress(),
                value: reward
            });

            // Register node first
            const nodeParams = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };

            // Grant SIGNER_ROLE to signer
            const signerRole = await governance.SIGNER_ROLE();
            await governance.connect(owner).grantRole(signerRole, signer.address);

            const attestation = await getNodeSignature(nodeParams, signer, governance);
            await governance.connect(node1).registerNode(nodeParams, attestation, {
                value: STAKE_AMOUNT
            });

            // Setup scheduler role
            const scheduler = user1;
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, scheduler.address);

            // Register task
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const tx = await governance.connect(user1).registerTask(
                taskId,
                dataHash,
                user2.address,
                reward,
                { value: reward }
            );
            const receipt = await tx.wait();
            // const taskRegisteredEvent = receipt?.logs[0] as EventLog;

            // Generate proof signature
            const proofHash = dataHash;
            const params = {
                taskId: taskId,
                dataHash: proofHash,
                nodeAddress: node1.address
            };
            const signature = await getProofHash(params, signer, governance);
            // Submit proof and update to Running
            await governance.connect(node1).submitProof(taskId, signature);
            {
                let task = await governance.tasks(taskId);
                expect(task.status).to.equal(TaskStatus.Created);
            }

            // update task status to Completed
            await governance.connect(scheduler).updateTaskStatus(taskId, TaskStatus.Completed);
            {
                let task = await governance.tasks(taskId);
                expect(task.status).to.equal(TaskStatus.Completed);
            }

            // Check rewards
            const rewardTotal = await governance.rewardStorage(node1.address);
            expect(rewardTotal).to.equal(reward / 2n);

            // claim rewards
            const balanceBefore = await ethers.provider.getBalance(node1.address);
            await governance.connect(node1).reward(node1.address, reward / 2n);
            const rewardClaimed = await governance.rewardStorage(node1.address);
            expect(rewardClaimed).to.equal(0);

            // check balance
            const balanceAfter = await ethers.provider.getBalance(node1.address);
            expect(balanceAfter).to.greaterThan(balanceBefore);
        });

        it("Should not allow non-scheduler to register task", async function () {
            const { governance, user1, user2 } = await loadFixture(deployTEERegistryFixture);
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const reward = ethers.parseEther("1");

            try {
                await governance.connect(user1).registerTask(
                    taskId,
                    dataHash,
                    user2.address,
                    reward
                );
            } catch (error: any) {
                const err = error.message;
                expect(err.includes("AccessControl")).to.be.true;
            }
        });

        it("Should not allow registering task with zero reward", async function () {
            const { governance, owner, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Grant SCHEDULER_ROLE to user1
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));

            await expect(
                governance.connect(user1).registerTask(
                    taskId,
                    dataHash,
                    user2.address,
                    0
                )
            ).to.be.revertedWith("Invalid reward amount");
        });

        it("Should not allow registering task with reward exceeding maximum", async function () {
            const { governance, owner, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Grant roles
            const schedulerRole = await governance.SCHEDULER_ROLE();
            const adminRole = await governance.ADMIN_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            // Set max reward amount
            const maxReward = ethers.parseEther("10");
            await governance.connect(owner).setMaxRewardAmount(maxReward);

            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const exceedingReward = maxReward + 1n;

            await expect(
                governance.connect(user1).registerTask(
                    taskId,
                    dataHash,
                    user2.address,
                    exceedingReward
                )
            ).to.be.revertedWith("Reward exceeds maximum");
        });

        it("Should allow admin to set max reward amount", async function () {
            const { governance, owner } = await loadFixture(deployTEERegistryFixture);

            const newMaxReward = ethers.parseEther("100");
            const tx = await governance.connect(owner).setMaxRewardAmount(newMaxReward);

            const receipt = await tx.wait();
            const event = receipt?.logs.find(log => log instanceof EventLog && log.eventName === "MaxRewardAmountUpdated") as EventLog;
            const oldMaxReward = await governance.getMaxRewardAmount();
            expect(event?.args[0]).to.equal(oldMaxReward);
            expect(event?.args[1]).to.equal(newMaxReward);

            // Verify state change
            expect(await governance.getMaxRewardAmount()).to.equal(newMaxReward);
        });

        it("Should not allow non-admin to set max reward amount", async function () {
            const { governance, user1 } = await loadFixture(deployTEERegistryFixture);

            const newMaxReward = ethers.parseEther("100");
            await expect(
                governance.connect(user1).setMaxRewardAmount(newMaxReward)
            ).to.be.revertedWithCustomError(
                governance,
                "AccessControlUnauthorizedAccount"
            );
        });

        it("Should not allow setting zero max reward amount", async function () {
            const { governance, owner } = await loadFixture(deployTEERegistryFixture);

            await expect(
                governance.connect(owner).setMaxRewardAmount(0)
            ).to.be.revertedWith("Invalid max reward amount");
        });

        it("Should handle task timeout correctly", async function () {
            const { governance, owner, signer, node1, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Setup roles and node
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            const nodeParams = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(nodeParams, signer, governance);
            await governance.connect(node1).registerNode(nodeParams, attestation, {
                value: STAKE_AMOUNT
            });

            // Register task
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const reward = ethers.parseEther("1");

            await governance.connect(user1).registerTask(
                taskId,
                dataHash,
                user2.address,
                reward
            );

            // Fast forward past timeout
            const timeout = await governance.getTaskTimeout();
            await mineXTimes(Number(timeout) + 1);

            // Update status to timeout
            await governance.connect(user1).updateTaskStatus(taskId, TaskStatus.Timeout);
            const task = await governance.tasks(taskId);
            expect(task.status).to.equal(TaskStatus.Timeout);
        });

        it("Should handle multiple nodes submitting proofs", async function () {
            const { governance, owner, signer, node1, node2, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Setup roles and nodes
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            // Register both nodes
            for (const node of [node1, node2]) {
                const nodeParams = {
                    nodeAddress: node.address,
                    rewardAddress: node.address,
                    publicKey: "0x",
                    apiEndpoint: "https://api.example.com",
                    registerTime: Math.floor(Date.now() / 1000),
                    teeType: 0
                };
                const attestation = await getNodeSignature(nodeParams, signer, governance);
                await governance.connect(node).registerNode(nodeParams, attestation, {
                    value: STAKE_AMOUNT
                });
            }

            // Register task
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const reward = ethers.parseEther("2"); // 2 ETH total reward

            await governance.connect(user1).registerTask(
                taskId,
                dataHash,
                user2.address,
                reward,
                { value: reward }
            );

            // Both nodes submit proofs
            for (const node of [node1, node2]) {
                const proofParams = {
                    taskId: taskId,
                    dataHash: dataHash,
                    nodeAddress: node.address
                };
                const signature = await getProofHash(proofParams, signer, governance);
                await governance.connect(node).submitProof(taskId, signature);
            }

            // Complete task
            await governance.connect(user1).updateTaskStatus(taskId, TaskStatus.Completed);

            // Check rewards
            const expectedReward = reward / 3n; // 1 ETH each
            expect(await governance.rewardStorage(node1.address)).to.equal(expectedReward);
            expect(await governance.rewardStorage(node2.address)).to.equal(expectedReward);
        });

        it("Should not allow proof submission after task completion", async function () {
            const { governance, owner, signer, node1, user1, user2 } = await loadFixture(deployTEERegistryFixture);

            // Setup roles and register node
            const schedulerRole = await governance.SCHEDULER_ROLE();
            await governance.connect(owner).grantRole(schedulerRole, user1.address);

            const nodeParams = {
                nodeAddress: node1.address,
                rewardAddress: node1.address,
                publicKey: "0x",
                apiEndpoint: "https://api.example.com",
                registerTime: Math.floor(Date.now() / 1000),
                teeType: 0
            };
            const attestation = await getNodeSignature(nodeParams, signer, governance);
            await governance.connect(node1).registerNode(nodeParams, attestation, {
                value: STAKE_AMOUNT
            });


            // Register and complete task
            const taskId = ethers.keccak256(ethers.randomBytes(32));
            const dataHash = ethers.keccak256(ethers.randomBytes(32));
            const reward = ethers.parseEther("1");

            await governance.connect(user1).registerTask(
                taskId,
                dataHash,
                user2.address,
                reward,
                { value: reward }
            );
            // Try to submit proof after completion
            const proofParams = {
                taskId: taskId,
                dataHash: dataHash,
                nodeAddress: node1.address
            };
            const signature = await getProofHash(proofParams, signer, governance);

            // submit proof
            await governance.connect(node1).submitProof(taskId, signature);

            // update task status to Completed
            await governance.connect(user1).updateTaskStatus(taskId, TaskStatus.Completed);
            const task = await governance.tasks(taskId);
            expect(task.status).to.equal(TaskStatus.Completed);
            await expect(
                governance.connect(node1).submitProof(taskId, signature)
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
}); 