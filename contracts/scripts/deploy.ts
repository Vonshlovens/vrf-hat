// Deploys RaffleDraw.
//   localhost:   also deploys Chainlink's VRF mock and a funded subscription.
//   baseSepolia: uses the real VRF v2.5 coordinator. With no VRF_SUBSCRIPTION_ID,
//                the deployer creates and funds a subscription itself, so the only
//                manual step is sending test ETH (and optionally LINK) to it.
// The deploying account becomes the drawer (the app server's key). It also owns
// the contract unless OWNER_ADDRESS is set, in which case that wallet must
// accept ownership on the app's /admin page.
// Writes deployments/<chainId>.json and updates ../.env.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import { formatEther, parseAbi, parseEther, parseEventLogs, type Address, type Hex } from "viem";

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const [deployer] = await viem.getWalletClients();
const me = deployer.account.address;

type VrfConfig = {
  coordinator: Address;
  subscriptionId: bigint;
  keyHash: Hex;
  requestConfirmations: number;
  callbackGasLimit: number;
  nativePayment: boolean;
  /** Whether the deployer owns the subscription and can add the consumer. */
  ownsSubscription: boolean;
};

// https://docs.chain.link/vrf/v2-5/supported-networks
const BASE_SEPOLIA = {
  coordinator: "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE",
  link: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
  keyHash: "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71", // 30 gwei lane
} as const;

const coordinatorAbi = parseAbi([
  "function createSubscription() returns (uint256 subId)",
  "event SubscriptionCreated(uint256 indexed subId, address owner)",
  "function fundSubscriptionWithNative(uint256 subId) payable",
  "function addConsumer(uint256 subId, address consumer)",
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
]);
const linkAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transferAndCall(address to, uint256 value, bytes data) returns (bool)",
]);

// VRF nodes only answer when the balance covers the worst case for the 30 gwei
// lane (~0.01 ETH of gas), so keep a margin above that.
const NATIVE_TARGET = parseEther("0.02");
const LINK_TARGET = parseEther("3");
const GAS_RESERVE = parseEther("0.002");

/** Stop with a plain message instead of Hardhat's crash report. */
function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

async function send(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`Transaction ${hash} reverted`);
  return receipt;
}

async function localVrf(): Promise<VrfConfig> {
  const mock = await viem.deployContract("VRFCoordinatorV2_5Mock", [
    100000000000000000n, // base fee (0.1 LINK)
    1000000000n, // gas price
    4000000000000000n, // wei per unit LINK
  ]);
  const receipt = await send(await mock.write.createSubscription());
  const [created] = parseEventLogs({
    abi: mock.abi,
    logs: receipt.logs,
    eventName: "SubscriptionCreated",
  });
  await send(await mock.write.fundSubscription([created.args.subId, 1000n * 10n ** 18n]));
  return {
    coordinator: mock.address,
    subscriptionId: created.args.subId,
    keyHash: BASE_SEPOLIA.keyHash,
    requestConfirmations: 1,
    callbackGasLimit: 200_000,
    nativePayment: false,
    ownsSubscription: true,
  };
}

async function baseSepoliaVrf(): Promise<VrfConfig> {
  const coordinator = BASE_SEPOLIA.coordinator;
  const [eth, link] = await Promise.all([
    publicClient.getBalance({ address: me }),
    publicClient.readContract({
      address: BASE_SEPOLIA.link,
      abi: linkAbi,
      functionName: "balanceOf",
      args: [me],
    }),
  ]);
  console.log(`Deployer ${me}: ${formatEther(eth)} ETH, ${formatEther(link)} LINK`);

  // Which subscription balance pays VRF fees. Default: LINK if the deployer
  // holds enough, otherwise ETH. The owner can switch later with setVrfConfig.
  const payWith = process.env.VRF_PAY_WITH || (link >= LINK_TARGET ? "link" : "eth");
  const nativePayment = payWith === "eth";

  let subId = process.env.VRF_SUBSCRIPTION_ID ? BigInt(process.env.VRF_SUBSCRIPTION_ID) : null;
  if (subId === null) {
    const needed = nativePayment ? NATIVE_TARGET + GAS_RESERVE : GAS_RESERVE;
    if (eth < needed) {
      fail(
        `Send at least ${formatEther(needed - eth)} more Base Sepolia ETH to ${me}` +
          (nativePayment ? ` (or ${formatEther(LINK_TARGET)} LINK to pay VRF fees in LINK)` : ""),
      );
    }
    console.log("Creating a VRF subscription...");
    const receipt = await send(
      await deployer.writeContract({
        address: coordinator,
        abi: coordinatorAbi,
        functionName: "createSubscription",
      }),
    );
    const [created] = parseEventLogs({
      abi: coordinatorAbi,
      logs: receipt.logs,
      eventName: "SubscriptionCreated",
    });
    subId = created.args.subId;
  }

  const sub = await publicClient.readContract({
    address: coordinator,
    abi: coordinatorAbi,
    functionName: "getSubscription",
    args: [subId],
  });
  const ownsSubscription = sub[3].toLowerCase() === me.toLowerCase();
  if (ownsSubscription) {
    if (nativePayment && sub[1] < NATIVE_TARGET) {
      const amount = NATIVE_TARGET - sub[1];
      console.log(`Funding subscription with ${formatEther(amount)} ETH...`);
      await send(
        await deployer.writeContract({
          address: coordinator,
          abi: coordinatorAbi,
          functionName: "fundSubscriptionWithNative",
          args: [subId],
          value: amount,
        }),
      );
    } else if (!nativePayment && sub[0] < LINK_TARGET) {
      const amount = link < LINK_TARGET - sub[0] ? link : LINK_TARGET - sub[0];
      if (amount === 0n) fail(`Send some Base Sepolia LINK to ${me}, or set VRF_PAY_WITH=eth`);
      console.log(`Funding subscription with ${formatEther(amount)} LINK...`);
      await send(
        await deployer.writeContract({
          address: BASE_SEPOLIA.link,
          abi: linkAbi,
          functionName: "transferAndCall",
          args: [coordinator, amount, `0x${subId.toString(16).padStart(64, "0")}`],
        }),
      );
    }
  }

  return {
    coordinator,
    subscriptionId: subId,
    keyHash: BASE_SEPOLIA.keyHash,
    requestConfirmations: 3,
    callbackGasLimit: 200_000,
    nativePayment,
    ownsSubscription,
  };
}

const proposedOwner = (process.env.OWNER_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
if (!/^0x[0-9a-fA-F]{40}$/.test(proposedOwner)) fail("OWNER_ADDRESS isn't an address");

const vrf =
  networkName === "localhost"
    ? await localVrf()
    : networkName === "baseSepolia"
      ? await baseSepoliaVrf()
      : null;
if (!vrf) fail(`No VRF config for network "${networkName}"`);

console.log(`Deploying RaffleDraw to ${networkName} (chain ${chainId})...`);
const raffle = await viem.deployContract("RaffleDraw", [
  vrf.coordinator,
  vrf.subscriptionId,
  vrf.keyHash,
  vrf.requestConfirmations,
  vrf.callbackGasLimit,
  vrf.nativePayment,
  me, // drawer
  proposedOwner,
]);
const deployBlock = await publicClient.getBlockNumber();

if (vrf.ownsSubscription) {
  console.log("Adding the contract as a subscription consumer...");
  await send(
    await deployer.writeContract({
      address: vrf.coordinator,
      abi: coordinatorAbi,
      functionName: "addConsumer",
      args: [vrf.subscriptionId, raffle.address],
    }),
  );
}

const deployment = {
  chainId,
  network: networkName,
  raffleDraw: raffle.address,
  deployBlock: deployBlock.toString(),
  coordinator: vrf.coordinator,
  coordinatorIsMock: networkName === "localhost",
  drawer: me,
  proposedOwner,
  subscriptionId: vrf.subscriptionId.toString(),
  keyHash: vrf.keyHash,
  nativePayment: vrf.nativePayment,
};
await mkdir("deployments", { recursive: true });
await writeFile(`deployments/${chainId}.json`, JSON.stringify(deployment, null, 2) + "\n");
console.log(JSON.stringify(deployment, null, 2));

if (networkName !== "localhost") {
  // Point the app at the new contract.
  const envPath = "../.env";
  let env = await readFile(envPath, "utf8");
  const set = (key: string, value: string) => {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, "m");
    env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
  };
  set("PUBLIC_CHAIN_ID", String(chainId));
  set("PUBLIC_RAFFLE_CONTRACT", raffle.address);
  set("VRF_SUBSCRIPTION_ID", vrf.subscriptionId.toString());
  await writeFile(envPath, env);
  console.log(`\nUpdated .env: PUBLIC_RAFFLE_CONTRACT=${raffle.address}`);

  if (!vrf.ownsSubscription) {
    console.log(
      `Next: add ${raffle.address} as a consumer of subscription ${vrf.subscriptionId} at https://vrf.chain.link`,
    );
  }
  if (!/^0x0{40}$/.test(proposedOwner)) {
    console.log(`Next: accept ownership with ${proposedOwner} on the app's /admin page`);
  }
} else {
  console.log(`\nApp env:\nPUBLIC_CHAIN_ID=${chainId}\nPUBLIC_RAFFLE_CONTRACT=${raffle.address}`);
}
