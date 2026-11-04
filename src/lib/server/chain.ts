// Server-side chain access: the only place that holds the drawer key.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DRAWER_PRIVATE_KEY, RPC_URL } from "$app/env/private";
import { PUBLIC_CHAIN_ID, PUBLIC_RAFFLE_CONTRACT } from "$app/env/public";
import { chainInfo } from "#lib/chain/chains.ts";
import { raffleDrawAbi } from "#lib/chain/raffle-draw-abi.ts";

const mockCoordinatorAbi = parseAbi([
  "function fulfillRandomWords(uint256 _requestId, address _consumer)",
]);

export function drawsEnabled(): boolean {
  return Boolean(DRAWER_PRIVATE_KEY && PUBLIC_RAFFLE_CONTRACT);
}

function clients() {
  if (!DRAWER_PRIVATE_KEY || !PUBLIC_RAFFLE_CONTRACT) {
    throw new Error("Draws are disabled: set DRAWER_PRIVATE_KEY and PUBLIC_RAFFLE_CONTRACT");
  }
  const { chain } = chainInfo(PUBLIC_CHAIN_ID);
  const transport = http(RPC_URL);
  return {
    address: PUBLIC_RAFFLE_CONTRACT,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({
      chain,
      transport,
      account: privateKeyToAccount(DRAWER_PRIVATE_KEY),
    }),
  };
}

/** Sends requestDraw. Calls `onSent` with the tx hash before waiting, so a timeout can be recovered. */
export async function sendDrawRequest(
  args: { raffleKey: Hex; root: Hex; entrantCount: number; winnerCount: number },
  onSent: (txHash: Hex) => Promise<void>,
) {
  const { address, publicClient, walletClient } = clients();
  const { request } = await publicClient.simulateContract({
    address,
    abi: raffleDrawAbi,
    functionName: "requestDraw",
    args: [args.raffleKey, args.root, args.entrantCount, args.winnerCount],
    account: walletClient.account,
  });
  const txHash = await walletClient.writeContract(request);
  await onSent(txHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`requestDraw reverted in ${txHash}`);
  const [ev] = parseEventLogs({
    abi: raffleDrawAbi,
    logs: receipt.logs,
    eventName: "DrawRequested",
  });
  return { txHash, requestId: ev.args.requestId };
}

export async function readDraw(raffleKey: Hex) {
  const { address, publicClient } = clients();
  return publicClient.readContract({
    address,
    abi: raffleDrawAbi,
    functionName: "getDraw",
    args: [raffleKey],
  });
}

/**
 * Local chain only: plays Chainlink's part by asking the mock coordinator to
 * answer. On a real network the coordinator does this by itself.
 */
export async function fulfillWithMock(requestId: bigint) {
  if (!chainInfo(PUBLIC_CHAIN_ID).mockCoordinator) throw new Error("not a mock chain");
  const { address, publicClient, walletClient } = clients();
  const coordinator = await publicClient.readContract({
    address,
    abi: raffleDrawAbi,
    functionName: "s_vrfCoordinator",
  });
  const hash = await walletClient.writeContract({
    address: coordinator,
    abi: mockCoordinatorAbi,
    functionName: "fulfillRandomWords",
    args: [requestId, address],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
