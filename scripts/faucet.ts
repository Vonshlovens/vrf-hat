// Tops up the drawer with Base Sepolia ETH from Coinbase's CDP faucet.
//
//   pnpm faucet [target-eth] [address]
//
// Each claim pays 0.0001 ETH, and an address can receive up to 0.1 ETH per
// rolling 24 hours. Needs CDP_API_KEY_ID and CDP_API_KEY_SECRET in .env
// (create a Secret API Key at https://portal.cdp.coinbase.com/api-keys/secret).
// The address defaults to the one derived from DRAWER_PRIVATE_KEY.
import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

process.loadEnvFile(".env");

const CLAIM = parseEther("0.0001");
const CONCURRENCY = 5;

const target = parseEther(process.argv[2] ?? "0.03");
const address = (process.argv[3] ??
  privateKeyToAccount(process.env.DRAWER_PRIVATE_KEY as Hex).address) as Address;

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.error("Set CDP_API_KEY_ID and CDP_API_KEY_SECRET in .env first.");
  process.exit(1);
}

const cdp = new CdpClient();
const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL),
});

const start = await client.getBalance({ address });
console.log(`${address} has ${formatEther(start)} ETH; target ${formatEther(target)} ETH.`);
const claimsNeeded = start >= target ? 0 : Number((target - start + CLAIM - 1n) / CLAIM);

let sent = 0;
let failed = 0;
let stopReason = null as string | null; // set by workers

async function worker() {
  while (!stopReason && sent < claimsNeeded) {
    sent++;
    try {
      await cdp.evm.requestFaucet({ address, network: "base-sepolia", token: "eth" });
      if (sent % 25 === 0) console.log(`  ${sent}/${claimsNeeded} claims sent`);
    } catch (err) {
      sent--;
      const e = err as { statusCode?: number; errorType?: string; errorMessage?: string };
      if (e.errorType === "faucet_limit_exceeded" || e.statusCode === 403) {
        stopReason = e.errorMessage ?? String(err);
      } else if (++failed > 20) {
        stopReason = `too many errors, last: ${e.errorMessage ?? String(err)}`;
      } else {
        // Rate limited or a transient error: back off a little.
        await new Promise((r) => setTimeout(r, 1000 * Math.min(failed, 5)));
      }
    }
  }
}

if (claimsNeeded > 0) {
  console.log(`Requesting ${claimsNeeded} claims...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (stopReason) console.log(`Stopped early: ${stopReason}`);
  console.log(`Sent ${sent} claims. Waiting for them to land...`);

  // Faucet transactions confirm over a few blocks.
  const expected = start + BigInt(sent) * CLAIM;
  for (let i = 0; i < 30; i++) {
    if ((await client.getBalance({ address })) >= expected) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log(`Balance: ${formatEther(await client.getBalance({ address }))} ETH`);
