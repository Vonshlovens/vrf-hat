# VRF Hat

Pull names from a hat that anyone can check. Hosts collect entries, and Chainlink VRF picks the
winners. Every raffle has a verify page that re-checks the whole draw in the browser against the
blockchain.

## How the draw is made verifiable

1. **Seal.** When the host draws, entries close and the list is numbered `0..n-1` in arrival order.
   A Merkle root of the list is stored on-chain by `RaffleDraw.requestDraw`, in the _same
   transaction_ that requests randomness, so the list is fixed before the number exists.
2. **One shot.** The contract allows one draw per raffle. `retryDraw` exists only for a request VRF
   never answered, only after ~1 hour, and the committed list can't change.
3. **Proof.** Chainlink's coordinator checks the VRF proof on-chain before calling back. The verify
   page also recomputes the coordinator's hash chain from the fulfillment calldata: proving key →
   key hash → request ID, pre-seed + request block hash → seed, gamma → VRF output → random word.
4. **Winners.** `pickWinners(randomWord, n, k)` is a pure partial Fisher–Yates shuffle, mirrored in
   `src/lib/draw/winners.ts`. The browser runs both versions and compares them.

The leaf format, tree rules and raffle key are in `src/lib/draw/commitment.ts`. Each sealed list is
published at `/r/<slug>/entrants.json`.

**What this does not prove:** that the entries are real people. The host can add any names before
drawing. What it does prove is that the list was fixed before the random number existed, and that
nobody chose the number.

## Stack

- SvelteKit 3 on Cloudflare Workers, using Vite+ (`vp`) for dev, build, lint, format and tests
- Better Auth: GitHub, Google and Discord (each enabled when its keys are set), plus magic links
  sent through Resend
- Neon Postgres via Drizzle (`neon-http` driver)
- Solidity contract built with Hardhat 3 and viem, in the `contracts/` workspace package
- Chainlink VRF v2.5 on Base Sepolia (testnet), with a local Hardhat chain and Chainlink's mock
  coordinator for development

## Local development

Requires Node 24 (`.node-version`) and pnpm.

```sh
pnpm install
cp .env.example .env            # fill in DATABASE_URL (Neon dev branch) and BETTER_AUTH_SECRET
pnpm db:migrate

pnpm chain                      # terminal 1: local Hardhat chain on :8545
pnpm chain:deploy               # deploys the VRF mock + RaffleDraw; prints PUBLIC_RAFFLE_CONTRACT
pnpm dev                        # terminal 2
```

For the local chain, set `PUBLIC_CHAIN_ID=31337`, `RPC_URL` and `PUBLIC_RPC_URL` to
`http://127.0.0.1:8545`, and `DRAWER_PRIVATE_KEY` to Hardhat's test account #0 (printed by
`pnpm chain`). The app plays Chainlink's role on the local chain, so draws complete immediately.
The proof step on the verify page is skipped there because the mock has no proof.

Without `RESEND_API_KEY`, magic links are printed to the dev server console.

Checks:

```sh
pnpm exec vp check              # format + lint
pnpm check                      # svelte-check (types)
pnpm test                       # unit tests + contract tests
pnpm verify-draw http://localhost:5173 <slug> http://127.0.0.1:8545   # verify page logic, from the CLI
```

## Deploying to Base Sepolia + Cloudflare

1. **Wallet.** Create a fresh key for deploying and drawing, and fund it with Base Sepolia ETH
   ([faucets](https://faucets.chain.link/base-sepolia)).
2. **VRF subscription.** At [vrf.chain.link](https://vrf.chain.link), create a subscription on Base
   Sepolia and fund it with testnet ETH. Draws pay in native ETH.
3. **Contract.**
   ```sh
   cd contracts
   pnpm exec hardhat keystore set BASE_SEPOLIA_RPC_URL     # or export them as env vars
   pnpm exec hardhat keystore set DEPLOYER_PRIVATE_KEY
   VRF_SUBSCRIPTION_ID=<id> pnpm deploy:base-sepolia
   ```
   Then add the printed contract address as a consumer of the subscription at vrf.chain.link.
4. **Database.** Run `pnpm db:migrate` with `DATABASE_URL` pointing at the Neon `main` branch.
5. **OAuth apps.** The callback URL is `<ORIGIN>/api/auth/callback/<github|google|discord>`.
6. **Worker.** Run `pnpm exec wrangler login`, then set secrets with `wrangler secret put`
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `DRAWER_PRIVATE_KEY`, `RESEND_API_KEY`, OAuth secrets).
   Set the non-secret values (`ORIGIN`, `PUBLIC_CHAIN_ID=84532`, `PUBLIC_RAFFLE_CONTRACT`,
   `EMAIL_FROM`, client IDs) as `vars` in `wrangler.jsonc`. Then run
   `pnpm build && pnpm exec wrangler deploy`.

Base mainnet: add the mainnet coordinator to `src/lib/chain/chains.ts` (`officialCoordinator`)
and a `base` branch to `contracts/scripts/deploy.ts`, using values from
[Chainlink's supported networks](https://docs.chain.link/vrf/v2-5/supported-networks).
