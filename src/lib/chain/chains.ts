// Chains the app can run against. Shared by server and browser.
import { base, baseSepolia, hardhat, type Chain } from "viem/chains";

export type ChainInfo = {
  chain: Chain;
  /** Block explorer base URL, or null for the local chain. */
  explorer: string | null;
  /** Local chains use Chainlink's mock coordinator, which produces no VRF proof. */
  mockCoordinator: boolean;
  /**
   * Chainlink's published VRF v2.5 coordinator. The verifier checks the
   * randomness came from this address, not one the raffle operator chose.
   * https://docs.chain.link/vrf/v2-5/supported-networks
   */
  officialCoordinator: `0x${string}` | null;
};

const chains: Record<number, ChainInfo> = {
  [hardhat.id]: {
    chain: hardhat,
    explorer: null,
    mockCoordinator: true,
    officialCoordinator: null,
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    explorer: "https://sepolia.basescan.org",
    mockCoordinator: false,
    officialCoordinator: "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE",
  },
  // TODO: fill in Base mainnet's coordinator from the Chainlink docs before using it.
  [base.id]: {
    chain: base,
    explorer: "https://basescan.org",
    mockCoordinator: false,
    officialCoordinator: null,
  },
};

export function chainInfo(chainId: number): ChainInfo {
  const info = chains[chainId];
  if (!info) throw new Error(`Unsupported chain ${chainId}`);
  return info;
}

export function explorerLink(
  chainId: number,
  kind: "tx" | "address" | "block",
  value: string | bigint,
) {
  const { explorer } = chainInfo(chainId);
  return explorer ? `${explorer}/${kind}/${value}` : null;
}
