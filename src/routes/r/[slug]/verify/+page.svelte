<script lang="ts">
  import { onMount } from "svelte";
  import { createPublicClient, http } from "viem";
  import { PUBLIC_RPC_URL } from "$app/env/public";
  import { chainInfo } from "#lib/chain/chains.ts";
  import { raffleDrawAbi } from "#lib/chain/raffle-draw-abi.ts";
  import { entrantLeaf, merkleProof } from "#lib/draw/commitment.ts";
  import { verifyDraw, type VerifyResult } from "#lib/verify/run.ts";

  let { data } = $props();
  const raffle = $derived(data.raffle);

  let result = $state<VerifyResult | null>(null);
  let running = $state(false);
  let query = $state("");
  let lookup = $state<{ label: string; ok: boolean | null; proof: string[]; leaf: string } | null>(null);

  const pad = (n: number) => String(n).padStart(4, "0");
  const done = $derived(result?.steps.filter((s) => s.status !== "pending") ?? []);
  const failed = $derived(result?.steps.filter((s) => s.status === "fail") ?? []);
  const allChecks = $derived(result?.steps.flatMap((s) => s.checks) ?? []);
  const verdict = $derived.by(() => {
    if (!result || running) return null;
    if (result.error || failed.length) return "fail";
    if (result.steps.some((s) => s.status === "pending")) return "pending";
    return "pass";
  });
  const matches = $derived(
    query.trim().length < 1
      ? []
      : (result?.entrants ?? [])
          .filter((e) => e.label.toLowerCase().includes(query.trim().toLowerCase()) || e.ticket.includes(query.trim().toLowerCase()))
          .slice(0, 8),
  );

  async function run() {
    if (!raffle.contract || !raffle.raffleKey || !raffle.chainId) return;
    running = true;
    result = null;
    await verifyDraw(
      {
        chainId: raffle.chainId,
        contract: raffle.contract,
        raffleKey: raffle.raffleKey,
        rpcUrl: PUBLIC_RPC_URL,
        entrantsUrl: `/r/${raffle.slug}/entrants.json`,
      },
      (r) => (result = r),
    );
    running = false;
  }

  async function checkEntry(index: number) {
    if (!result || !raffle.contract || !raffle.chainId) return;
    const entrant = result.entrants[index];
    const leaves = result.entrants.map(entrantLeaf);
    const proof = merkleProof(leaves, index);
    lookup = { label: entrant.label, ok: null, proof, leaf: leaves[index] };
    const client = createPublicClient({ chain: chainInfo(raffle.chainId).chain, transport: http(PUBLIC_RPC_URL) });
    const ok = await client.readContract({
      address: raffle.contract,
      abi: raffleDrawAbi,
      functionName: "isCommittedEntrant",
      args: [raffle.raffleKey!, leaves[index], proof],
    });
    lookup = { ...lookup, ok };
  }

  onMount(() => {
    if (raffle.status !== "open") run();
  });
</script>

<svelte:head><title>Verify: {raffle.title} | VRF Hat</title></svelte:head>

<article class="wrap">
  <header class="head">
    <a class="back" href="/r/{raffle.slug}">{raffle.title}</a>
    <h1>Check this draw</h1>
    <p class="muted">
      Your browser is reading the blockchain directly and redoing each step of the draw. It doesn't rely
      on anything this site says beyond where to look.
    </p>
  </header>

  {#if raffle.status === "open"}
    <p class="callout">Entries are still open. Once the host draws, this page can check every step.</p>
  {:else}
    <div class="verdict {verdict ?? 'running'}" role="status" aria-live="polite">
      {#if verdict === "pass"}
        <strong>All {allChecks.length} checks passed.</strong> The winners were fixed by Chainlink's number and
        a list that was sealed before it existed.
        {#if result?.steps.some((s) => s.status === "skip")}
          The proof check was skipped because this draw ran on a local test chain.
        {/if}
      {:else if verdict === "fail"}
        <strong>Something didn't check out.</strong>
        {result?.error ?? `${failed.length} step${failed.length === 1 ? "" : "s"} failed; see below.`}
      {:else if verdict === "pending"}
        <strong>Waiting for Chainlink.</strong> The list is sealed; the random number hasn't arrived yet.
      {:else}
        Checking {done.length} of 4 steps…
      {/if}
      {#if !running}<button class="quiet again" onclick={run}>Check again</button>{/if}
    </div>

    {#if result}
      <ol class="chain">
        {#each result.steps as step, i (step.id)}
          <li class="stub {step.status}">
            <div class="punch" aria-hidden="true">
              <span class="hole"></span>
              <span class="num">{i + 1}</span>
            </div>
            <div class="body">
              <h2>{step.title}</h2>
              <p class="summary">
                {step.summary}
                <span class="sr-only">
                  Status: {step.status === "pass" ? "passed" : step.status === "fail" ? "failed" : step.status === "skip" ? "skipped" : "pending"}.
                </span>
              </p>
              {#if step.note}<p class="note">{step.note}</p>{/if}

              {#if step.checks.length}
                <ul class="checks">
                  {#each step.checks as c (c.label)}
                    <li class:bad={!c.ok}><span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.label}</li>
                  {/each}
                </ul>
              {/if}

              {#if step.facts.length}
                <dl class="facts">
                  {#each step.facts as f (f.label)}
                    <div>
                      <dt>{f.label}</dt>
                      <dd class:mono={f.mono}>
                        {#if f.href}<a href={f.href} target="_blank" rel="noreferrer">{f.value}</a>{:else}{f.value}{/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {/if}

              {#if step.id === "winners" && result.shuffle.length}
                <div class="scroll">
                <table class="shuffle">
                  <caption>The shuffle, step by step</caption>
                  <thead>
                    <tr><th scope="col">Step</th><th scope="col">Hash of (number, step)</th><th scope="col">Mod</th><th scope="col">Winner</th></tr>
                  </thead>
                  <tbody>
                    {#each result.shuffle as s (s.step)}
                      <tr>
                        <td>{s.step + 1}</td>
                        <td class="mono">{s.hash.slice(0, 10)}…</td>
                        <td class="mono">{s.step} + h mod {s.range} = {s.j}</td>
                        <td><strong>{s.label}</strong> <span class="muted mono">No. {pad(s.position + 1)}</span></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      {#if result.entrants.length}
        <section class="find">
          <h2>Find your entry</h2>
          <p class="muted">
            Search for a name or ticket, then ask the contract itself whether it was in the sealed list.
          </p>
          <label for="q" class="sr-only">Name or ticket</label>
          <input id="q" type="text" bind:value={query} placeholder="Name or ticket" autocomplete="off" />
          {#if matches.length}
            <ul class="matches">
              {#each matches as m (m.index)}
                <li>
                  <span><strong>{m.label}</strong> <span class="muted mono">No. {pad(m.index + 1)}</span></span>
                  <button class="secondary" onclick={() => checkEntry(m.index)}>Check on-chain</button>
                </li>
              {/each}
            </ul>
          {:else if query.trim()}
            <p class="muted">No entry matches "{query}".</p>
          {/if}
          {#if lookup}
            <div class="lookup" class:bad={lookup.ok === false} role="status">
              {#if lookup.ok === null}
                Asking the contract about {lookup.label}…
              {:else if lookup.ok}
                ✓ The contract confirms <strong>{lookup.label}</strong> was in the sealed list
                ({lookup.proof.length} hashes in the proof).
              {:else}
                ✗ The contract says this entry was not in the sealed list.
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      <section class="diy">
        <h2>Check it without this site</h2>
        <ol>
          <li>
            Download <a href="/r/{raffle.slug}/entrants.json">the sealed entry list</a>. Each entry's leaf is
            <code>keccak256(keccak256(abi.encode(uint32 index, bytes16 ticket, string label)))</code>; pairs
            are hashed in sorted order, and an unpaired node moves up unchanged.
          </li>
          <li>
            On the contract <code>{raffle.contract}</code>, call <code>getDraw({raffle.raffleKey})</code>
            and compare <code>entrantsRoot</code> with your rebuilt root. The raffle key is
            <code>keccak256("vrf-hat:raffle:{raffle.raffleId}")</code>.
          </li>
          <li>
            Call <code>pickWinners(randomWord, entrantCount, winnerCount)</code> and look up those positions
            in the list. The source is in <code>contracts/RaffleDraw.sol</code>.
          </li>
        </ol>
      </section>
    {/if}
  {/if}
</article>

<style>
  .head {
    padding-top: 2rem;
    margin-bottom: 1.75rem;
  }
  .back {
    display: inline-block;
    margin-bottom: 0.75rem;
  }
  .callout {
    padding: 1rem 1.25rem;
    background: var(--surface);
    border-left: 4px solid var(--rule);
  }

  .verdict {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.5rem;
    padding: 1rem 1.25rem;
    margin-bottom: 2rem;
    background: var(--surface);
    border-left: 4px solid var(--rule);
  }
  .verdict.pass {
    border-color: var(--pass);
  }
  .verdict.fail {
    border-color: var(--fail);
  }
  .verdict.pending {
    border-color: var(--ticket);
  }
  .again {
    margin-left: auto;
    color: var(--cobalt);
  }

  /* The chain of custody: stubs joined by perforations. */
  .chain {
    list-style: none;
    padding: 0;
    margin: 0 0 3rem;
  }
  .stub {
    --edge: var(--rule);
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr);
    background: var(--surface);
    border-radius: 4px;
    position: relative;
  }
  .stub + .stub {
    margin-top: 0;
    border-top: 2px dashed var(--paper);
  }
  .stub:first-child {
    border-radius: 4px 4px 0 0;
  }
  .stub:last-child {
    border-radius: 0 0 4px 4px;
  }
  .stub:not(:first-child):not(:last-child) {
    border-radius: 0;
  }
  .punch {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 1.4rem;
    border-right: 2px dashed var(--paper);
    background: var(--paper-deep);
  }
  /* The hole punched when a step passes. */
  .hole {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    border: 2px solid var(--rule);
    background: var(--surface);
    transition:
      background 300ms,
      border-color 300ms,
      transform 300ms;
  }
  .num {
    margin-top: 0.4rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .pass .hole {
    background: var(--paper);
    border-color: var(--pass);
    box-shadow: inset 0 0 0 4px var(--pass);
    transform: scale(1.05);
  }
  .fail .hole {
    background: var(--fail);
    border-color: var(--fail);
  }
  .skip .hole {
    border-style: dashed;
  }
  .pending .hole {
    border-top-color: var(--ink);
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .body {
    padding: 1.25rem 1.25rem 1.25rem 1.1rem;
    min-width: 0;
  }
  .body h2 {
    font-size: var(--t-md);
    margin-bottom: 0.25em;
  }
  .summary {
    color: var(--ink-soft);
  }
  .note {
    font-size: var(--t-sm);
    padding: 0.6rem 0.8rem;
    background: var(--paper);
    border-radius: 4px;
  }
  .checks {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  .checks li {
    padding: 0.15rem 0;
    color: var(--pass);
    font-weight: 500;
  }
  .checks li.bad {
    color: var(--fail);
    font-weight: 700;
  }
  .facts {
    margin: 0;
    display: grid;
    gap: 0.45rem;
    font-size: var(--t-sm);
  }
  .facts div {
    display: grid;
    grid-template-columns: minmax(8rem, 14rem) 1fr;
    gap: 0.75rem;
  }
  .facts dt {
    color: var(--ink-soft);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 560px) {
    .stub {
      grid-template-columns: 2.6rem minmax(0, 1fr);
    }
    .body {
      padding: 1rem 0.9rem;
    }
    .facts div {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }

  .scroll {
    overflow-x: auto;
  }
  .shuffle {
    width: 100%;
    margin-top: 1.25rem;
    border-collapse: collapse;
    font-size: var(--t-sm);
  }
  .shuffle caption {
    text-align: left;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .shuffle th {
    text-align: left;
    font-weight: 600;
    color: var(--ink-soft);
    border-bottom: 1px solid var(--rule);
    padding: 0.3rem 0.5rem 0.3rem 0;
  }
  .shuffle td {
    padding: 0.4rem 0.5rem 0.4rem 0;
    border-bottom: 1px solid var(--paper-deep);
    vertical-align: top;
  }

  .find,
  .diy {
    margin-bottom: 3rem;
  }
  .matches {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
  }
  .matches li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--rule);
  }
  .matches button {
    padding: 0.35em 0.8em;
    font-size: var(--t-sm);
  }
  .lookup {
    margin-top: 1rem;
    padding: 0.8rem 1rem;
    background: var(--surface);
    border-left: 4px solid var(--pass);
  }
  .lookup.bad {
    border-color: var(--fail);
  }
  .diy li {
    margin-bottom: 0.75rem;
    max-width: 40em;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
