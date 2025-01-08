import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";

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
        }
    },
    gasReporter: {
        enabled: true,
        currency: "USD"
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
