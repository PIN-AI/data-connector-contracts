import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";

const config = {
    solidity: {
        version: "0.8.27",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true
        },
        baseSepolia: {
            url: process.env.BASE_SEPOLIA_RPC_URL || "",
            accounts: [PRIVATE_KEY],
            chainId: 84532,
            verify: {
                etherscan: {
                    apiKey: process.env.BASESCAN_API_KEY
                }
            }
        },
        sepolia: {
            url: process.env.SEPOLIA_RPC_URL || "",
            accounts: [PRIVATE_KEY],
            chainId: 11155111,
            verify: {
                etherscan: {
                    apiKey: process.env.ETHERSCAN_API_KEY
                }
            }
        },
        bscTestnet: {
            url: process.env.BSC_TESTNET_RPC_URL || "",
            accounts: [PRIVATE_KEY],
            chainId: 97,
            verify: {
                etherscan: {
                    apiKey: process.env.BSCSCAN_API_KEY
                }
            }
        },
        mumbai: {
            url: process.env.MUMBAI_RPC_URL || "",
            accounts: [PRIVATE_KEY],
            chainId: 80001,
            verify: {
                etherscan: {
                    apiKey: process.env.POLYGONSCAN_API_KEY
                }
            }
        }
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
        coinmarketcap: process.env.COINMARKETCAP_API_KEY
    },
    etherscan: {
        apiKey: {
            sepolia: process.env.ETHERSCAN_API_KEY || "",
            baseSepolia: process.env.BASESCAN_API_KEY || "",
            goerli: process.env.ETHERSCAN_API_KEY || "",
            bscTestnet: process.env.BSCSCAN_API_KEY || "",
            polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
            mainnet: process.env.ETHERSCAN_API_KEY || ""
        }
    },
    coverage: {
        enableProxy: true,
        includeImplementationContracts: true,
        exclude: [
            "contracts/test/**/*",
            "contracts/mock/**/*"
        ],
        watermarks: {
            statements: [80, 95],
            branches: [80, 95],
            functions: [80, 95],
            lines: [80, 95]
        }
    }
} as HardhatUserConfig;

export default config;
