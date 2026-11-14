# VRF Hat

Pull names from a hat that anyone can check. Hosts collect entries, and Chainlink VRF picks the
winners. Every draw has a verify page that re-checks it in the browser against the blockchain.

A raffle can:

- draw **winners** or **eliminations** (a name is out once all its tickets are pulled);
- give a name **several tickets** (`Dev Patel x3`), each a separate slot in the sealed list;
- draw **once, on a schedule, or whenever the host says**, round after round.

## How the draw is made verifiable

1. **Seal.** When a draw starts, entries close and the tickets in the hat are numbered `0..n-1` in
   arrival order, one slot per ticket. A Merkle root of the list is stored on-chain by
   `RaffleDraw.requestDraw`, in the _same transaction_ that requests randomness, so the list is
   fixed before the number exists.
2. **One shot.** The contract allows one draw per key, and every round has its own key. `retryDraw`
   exists only for a request VRF never answered, only after ~1 hour, and the committed list can't
   change.
3. **Proof.** Chainlink's coordinator checks the VRF proof on-chain before calling back. The verify
   page also recomputes the coordinator's hash chain from the fulfillment calldata: proving key →
   key hash → request ID, pre-seed + request block hash → seed, gamma → VRF output → random word.
4. **Winners.** `pickWinners(randomWord, n, k)` is a pure partial Fisher–Yates shuffle, mirrored in
   `src/lib/draw/winners.ts`. The browser runs both versions and compares them.

The leaf format, tree rules and draw key are in `src/lib/draw/commitment.ts`. Each sealed list is
published at `/r/<slug>/entrants.json?round=<n>` (the latest round without `round`).

### Rounds, modes and tickets

The contract is unchanged by any of this: it still sees a key, a root, a ticket count and a pick
count. The meaning lives in the key.

- **Key.** `keccak256("vrf-hat:raffle:<id>:<mode>:<round>")`, where mode is `win` or `eliminate`.
  Round 1 of a `win` raffle keeps the original `keccak256("vrf-hat:raffle:<id>")`. Because the mode
  is in the key, a host can't run a draw and decide afterwards whether it picked winners or losers.
  The verify page checks the key against that text.
- **Tickets.** A name with `count` tickets takes `count` consecutive slots, all with the same ticket
  ID and label. Pulled slots are recorded per round in `draw_slot`, which is also the published list.
- **Rounds.** After a round, pulled tickets leave the hat (unless a `win` raffle returns winners) and
  the raffle reopens. The rules for how many tickets a round pulls and when a raffle is finished are
  in `src/lib/draw/rounds.ts`; schedule arithmetic is in `src/lib/draw/schedule.ts`.
- **Schedule.** A Cloudflare cron trigger runs every minute, starts rounds that are due and collects
  answers from Chainlink. The SvelteKit adapter's Worker has no cron handler, so `pnpm build` wraps
  it with `cloudflare/worker.js`, which turns each cron run into a signed `POST /cron`. A raffle page that is open when
  its draw comes due does the same, which is what drives schedules under `pnpm dev`. Missed slots
  are skipped, not caught up.

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
pnpm verify-draw http://localhost:5173 <slug> http://127.0.0.1:8545 [round]   # verify page logic, from the CLI
```

## Deploying to Base Sepolia + Cloudflare

The **drawer** is the app server's key (`DRAWER_PRIVATE_KEY`, a fresh key, never a reused wallet
key). It requests draws and pays gas.

1. **Fund the drawer.** Send it about 0.03 Base Sepolia ETH. Optionally also send 3+ testnet LINK,
   which makes VRF fees come out of LINK instead of ETH.
2. **Deploy.** Run `pnpm -C contracts deploy:base-sepolia`. With `VRF_SUBSCRIPTION_ID` empty, the
   drawer creates and funds a VRF subscription, deploys the contract, adds it as a consumer, and
   writes `PUBLIC_RAFFLE_CONTRACT` and `VRF_SUBSCRIPTION_ID` into `.env`. Restart the dev server.

By default the drawer also owns the contract and the subscription. That's fine for a testnet. For
real money, split the roles: set `OWNER_ADDRESS` to your own wallet before deploying, then accept
ownership on `/admin`. That wallet can then replace the drawer and change VRF settings, so a leaked
server key can't reconfigure anything. Also create the subscription from that wallet at
[vrf.chain.link](https://vrf.chain.link) and set `VRF_SUBSCRIPTION_ID`, so the server key can't
spend the subscription's balance.

3. **Database.** Run `pnpm db:migrate` with `DATABASE_URL` pointing at the Neon `main` branch.
   Migrations are not part of the deploy; run them just before pushing code that needs them.
4. **OAuth apps.** The callback URL is `<ORIGIN>/api/auth/callback/<github|google|discord>`.
5. **Worker.** Run `pnpm exec wrangler login`, then set secrets with `wrangler secret put`
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `DRAWER_PRIVATE_KEY`, `RESEND_API_KEY`, OAuth secrets).
   Set the non-secret values (`ORIGIN`, `PUBLIC_CHAIN_ID=84532`, `PUBLIC_RAFFLE_CONTRACT`,
   `EMAIL_FROM`, client IDs) as `vars` in `wrangler.jsonc`. Then run
   `pnpm build && pnpm exec wrangler deploy`. The deploy also registers the every-minute cron
   trigger that runs scheduled draws.

For mainnet, keep the owner on a hardware wallet. Consider a signing service (cloud KMS, Turnkey,
Privy) for the drawer instead of a raw key in a Worker secret.

Base mainnet: add the mainnet coordinator to `src/lib/chain/chains.ts` (`officialCoordinator`)
and a `base` branch to `contracts/scripts/deploy.ts`, using values from
[Chainlink's supported networks](https://docs.chain.link/vrf/v2-5/supported-networks).
