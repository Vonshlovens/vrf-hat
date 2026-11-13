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

  const stepWord = (status: string) =>
    status === "pass"
      ? { tone: "ok", word: "passed" }
      : status === "fail"
        ? { tone: "fail", word: "failed" }
        : status === "skip"
          ? { tone: "idle", word: "skipped" }
          : { tone: "run", word: running ? "checking" : "waiting" };

  onMount(() => {
    if (raffle.status !== "open") run();
  });
</script>

<svelte:head><title>Verify: {raffle.title} | VRF Hat</title></svelte:head>

<article class="page reading">
  <header class="page-head">
    <a class="crumb" href="/r/{raffle.slug}">← {raffle.title}</a>
    <h1>Check this draw</h1>
  </header>

  {#if raffle.status === "open"}
    <p class="meta">Entries are still open. Check back after the draw.</p>
  {:else}
    <div class="verdict" role="status" aria-live="polite">
      {#if verdict === "pass"}
        <span class="status" data-tone="ok">verified</span>
        <span>All {allChecks.length} checks passed.</span>
      {:else if verdict === "fail"}
        <span class="status" data-tone="fail">failed</span>
        <span>{result?.error ?? `${failed.length} step${failed.length === 1 ? "" : "s"} failed.`}</span>
      {:else if verdict === "pending"}
        <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>waiting</span>
        <span>Chainlink hasn't answered yet.</span>
      {:else}
        <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>checking</span>
        <span class="meta">{done.length} of 4</span>
      {/if}
      {#if !running}<button class="btn ghost small again" onclick={run}>Check again</button>{/if}
    </div>

    {#if result}
      <ol class="chain">
        {#each result.steps as step, i (step.id)}
          {@const sw = stepWord(step.status)}
          <li class="link" data-state={step.status}>
            <span class="n" aria-hidden="true">{i + 1}</span>
            <div class="body">
              <div class="link-head">
                <h2 class="h3">{step.title}</h2>
                <span class="status" data-tone={sw.tone}>
                  {#if sw.tone === "run"}<span class="live" aria-hidden="true"></span>{/if}{sw.word}
                </span>
              </div>
              {#if step.note}<p class="hint note">{step.note}</p>{/if}

              {#if step.checks.length || step.facts.length}
                <details open={step.status === "fail"}>
                  <summary class="small">Details</summary>
                  <div class="flow detail">
                    {#if step.checks.length}
                      <ul class="plan">
                        {#each step.checks as c (c.label)}
                          <li>
                            <span class="status" data-tone={c.ok ? "ok" : "fail"}>{c.ok ? "ok" : "failed"}</span>
                            <span class="plan-text">{c.label}</span>
                          </li>
                        {/each}
                      </ul>
                    {/if}

                    {#if step.facts.length}
                      <dl class="kv">
                        {#each step.facts as f (f.label)}
                          <div>
                            <dt>{f.label}</dt>
                            <dd>
                              {#if f.href}<a href={f.href} target="_blank" rel="noreferrer">{f.value}</a>{:else}{f.value}{/if}
                            </dd>
                          </div>
                        {/each}
                      </dl>
                    {/if}

                    {#if step.id === "winners" && result.shuffle.length}
                      <div class="table-wrap">
                        <table class="table">
                          <caption>The shuffle</caption>
                          <thead>
                            <tr>
                              <th scope="col" class="num w-min">Step</th>
                              <th scope="col">Hash</th>
                              <th scope="col">Mod</th>
                              <th scope="col">Winner</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each result.shuffle as s (s.step)}
                              <tr>
                                <td class="num w-min">{s.step + 1}</td>
                                <td class="id">{s.hash.slice(0, 10)}…</td>
                                <td>{s.step} + h mod {s.range} = {s.j}</td>
                                <td><strong>{s.label}</strong> <span class="meta">No. {pad(s.position + 1)}</span></td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  </div>
                </details>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      {#if result.entrants.length}
        <section class="find">
          <div class="field search">
            <label for="q">Find an entry</label>
            <input class="input" id="q" type="search" bind:value={query} placeholder="Name or ticket" autocomplete="off" />
          </div>
          {#if matches.length}
            <table class="table">
              <tbody>
                {#each matches as m (m.index)}
                  <tr>
                    <td class="id w-min meta">{pad(m.index + 1)}</td>
                    <th scope="row">{m.label}</th>
                    <td class="w-min"><button class="btn small" onclick={() => checkEntry(m.index)}>Check on-chain</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else if query.trim()}
            <p class="meta">No match.</p>
          {/if}
          {#if lookup}
            <p class="lookup" role="status">
              {#if lookup.ok === null}
                <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>asking</span>
                {lookup.label}
              {:else if lookup.ok}
                <span class="status" data-tone="ok">in the sealed list</span>
                {lookup.label} <span class="meta">({lookup.proof.length}-hash proof)</span>
              {:else}
                <span class="status" data-tone="fail">not in the sealed list</span>
                {lookup.label}
              {/if}
            </p>
          {/if}
        </section>
      {/if}

      <p class="more small">
        <a href="/r/{raffle.slug}/verify/by-hand">Check it by hand</a>
        <a href="/how#verify">What's checked</a>
      </p>
    {/if}
  {/if}
</article>

<style>
  .verdict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) 1.5ch;
    padding-bottom: var(--s-2);
  }
  .again {
    margin-left: auto;
  }

  .chain {
    list-style: none;
    padding: 0;
    border-top: var(--rule-w) solid var(--rule);
    border-bottom: var(--rule-w) solid var(--rule);
  }
  .link {
    display: grid;
    grid-template-columns: 3ch minmax(0, 1fr);
    gap: 0 1.5ch;
    padding: var(--s-3) 0;
  }
  .link + .link {
    border-top: var(--hair-w) solid var(--line);
  }
  .link[data-state="fail"] {
    background: var(--fail-wash);
  }
  .n {
    font-weight: var(--fw-bold);
    text-align: right;
    color: var(--ink-3);
  }
  .body {
    min-width: 0;
    padding-right: var(--cell-x);
  }
  .link-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-1) var(--gutter);
  }
  .note {
    margin-top: var(--s-1);
  }
  details {
    margin-top: var(--s-1);
  }
  summary {
    width: fit-content;
    cursor: pointer;
    color: var(--ink-3);
  }
  summary:hover {
    color: var(--ink);
  }
  .detail {
    --flow-space: var(--s-3);
    margin-top: var(--s-2);
  }
  .plan li {
    padding-inline: 0;
  }

  .find {
    display: grid;
    gap: var(--s-3);
    margin-top: calc(var(--lh) * 2);
  }
  .search {
    max-width: 48ch;
  }
  .lookup {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) 1ch;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--gutter);
    margin-top: calc(var(--lh) * 2);
  }
</style>
