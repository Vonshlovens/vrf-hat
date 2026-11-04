// Deploys RaffleDraw.
//   localhost:   also deploys Chainlink's VRF mock and a funded subscription.
//   baseSepolia: uses the real VRF v2.5 coordinator; needs VRF_SUBSCRIPTION_ID
//                and OWNER_ADDRESS (the wallet that will own the contract).
// The deploying account becomes the drawer (the app server's key).
// Writes deployments/<chainId>.json, which the app reads via PUBLIC_* env vars.
import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import { parseEventLogs, type Address, type Hex } from "viem";

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

type VrfConfig = {
  coordinator: Address;
  subscriptionId: bigint;
  keyHash: Hex;
  requestConfirmations: number;
  callbackGasLimit: number;
  nativePayment: boolean;
};

// https://docs.chain.link/vrf/v2-5/supported-networks
const BASE_SEPOLIA = {
  coordinator: "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE",
  keyHash: "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71", // 30 gwei lane
} as const;

async function localVrf(): Promise<VrfConfig> {
  const mock = await viem.deployContract("VRFCoordinatorV2_5Mock", [
    100000000000000000n, // base fee (0.1 LINK)
    1000000000n, // gas price
    4000000000000000n, // wei per unit LINK
  ]);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: await mock.write.createSubscription(),
  });
  const [created] = parseEventLogs({
    abi: mock.abi,
    logs: receipt.logs,
    eventName: "SubscriptionCreated",
  });
  await publicClient.waitForTransactionReceipt({
    hash: await mock.write.fundSubscription([created.args.subId, 1000n * 10n ** 18n]),
  });
  return {
    coordinator: mock.address,
    subscriptionId: created.args.subId,
    keyHash: BASE_SEPOLIA.keyHash,
    requestConfirmations: 1,
    callbackGasLimit: 200_000,
    nativePayment: false,
  };
}

function baseSepoliaVrf(): VrfConfig {
  const sub = process.env.VRF_SUBSCRIPTION_ID;
  if (!sub) throw new Error("Set VRF_SUBSCRIPTION_ID (create one at https://vrf.chain.link)");
  return {
    coordinator: BASE_SEPOLIA.coordinator,
    subscriptionId: BigInt(sub),
    keyHash: BASE_SEPOLIA.keyHash,
    requestConfirmations: 3,
    callbackGasLimit: 200_000,
    nativePayment: true, // pay VRF fees in ETH from the subscription
  };
}

const [deployer] = await viem.getWalletClients();
const drawer = deployer.account.address;
const proposedOwner = (process.env.OWNER_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
if (
  networkName !== "localhost" &&
  (!/^0x[0-9a-fA-F]{40}$/.test(proposedOwner) || /^0x0{40}$/.test(proposedOwner))
) {
  throw new Error("Set OWNER_ADDRESS to the wallet that should own the contract");
}

const vrf =
  networkName === "localhost"
    ? await localVrf()
    : networkName === "baseSepolia"
      ? baseSepoliaVrf()
      : null;
if (!vrf) throw new Error(`No VRF config for network "${networkName}"`);

console.log(`Deploying RaffleDraw to ${networkName} (chain ${chainId})...`);
const raffle = await viem.deployContract("RaffleDraw", [
  vrf.coordinator,
  vrf.subscriptionId,
  vrf.keyHash,
  vrf.requestConfirmations,
  vrf.callbackGasLimit,
  vrf.nativePayment,
  drawer,
  proposedOwner,
]);
const deployBlock = await publicClient.getBlockNumber();

if (networkName === "localhost") {
  const mock = await viem.getContractAt("VRFCoordinatorV2_5Mock", vrf.coordinator);
  await publicClient.waitForTransactionReceipt({
    hash: await mock.write.addConsumer([vrf.subscriptionId, raffle.address]),
  });
}

const deployment = {
  chainId,
  network: networkName,
  raffleDraw: raffle.address,
  deployBlock: deployBlock.toString(),
  coordinator: vrf.coordinator,
  coordinatorIsMock: networkName === "localhost",
  drawer,
  proposedOwner,
  subscriptionId: vrf.subscriptionId.toString(),
  keyHash: vrf.keyHash,
};
await mkdir("deployments", { recursive: true });
await writeFile(`deployments/${chainId}.json`, JSON.stringify(deployment, null, 2) + "\n");

console.log(JSON.stringify(deployment, null, 2));
console.log(`\nApp env:\nPUBLIC_CHAIN_ID=${chainId}\nPUBLIC_RAFFLE_CONTRACT=${raffle.address}`);
if (networkName !== "localhost") {
  console.log(
    `\nNext:\n  1. Add ${raffle.address} as a consumer of subscription ${vrf.subscriptionId} at https://vrf.chain.link`,
  );
  console.log(`  2. Accept ownership with ${proposedOwner} on the app's /admin page`);
}
