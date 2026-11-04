import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Share the app's .env, so the drawer key lives in one place.
try {
  process.loadEnvFile("../.env");
} catch {
  // no .env; rely on the environment
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.30",
    settings: { optimizer: { enabled: true, runs: 200 } },
    // Chainlink's VRF v2.5 mock, for tests and the local dev chain. It skips
    // proof verification, so it is never deployed to a public network.
    npmFilesToBuild: ["@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol"],
  },
  networks: {
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      // The drawer key deploys; ownership is then handed to OWNER_ADDRESS.
      accounts: [configVariable("DRAWER_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_RPC_URL"),
      accounts: [configVariable("DRAWER_PRIVATE_KEY")],
    },
  },
});
