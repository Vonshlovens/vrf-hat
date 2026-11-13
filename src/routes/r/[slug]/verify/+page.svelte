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
  const verdictTone = $derived(
    verdict === "pass" ? "ok" : verdict === "fail" ? "fail" : "run",
  );

  onMount(() => {
    if (raffle.status !== "open") run();
  });
</script>

<svelte:head><title>Verify: {raffle.title} | VRF Hat</title></svelte:head>

<article class="page reading">
  <header class="page-head">
    <a class="crumb" href="/r/{raffle.slug}">← {raffle.title}</a>
    <h1>Check this draw</h1>
    <p class="lede">
      Your browser is reading the blockchain directly and redoing each step of the draw. It doesn't rely
      on anything this site says beyond where to look.
    </p>
  </header>

  {#if raffle.status === "open"}
    <div class="state">
      <h3><span class="status" data-tone="idle">not drawn</span> Entries are still open</h3>
      <p>Once the host draws, this page can check every step.</p>
    </div>
  {:else}
    <div class="notice verdict" data-tone={verdictTone} role="status" aria-live="polite">
      {#if verdict === "pass"}
        <span class="status" data-tone="ok">verified</span>
        <span>
          <strong>All {allChecks.length} checks passed.</strong> The winners were fixed by Chainlink's number
          and a list that was sealed before it existed.
          {#if result?.steps.some((s) => s.status === "skip")}
            The proof check was skipped because this draw ran on a local test chain.
          {/if}
        </span>
      {:else if verdict === "fail"}
        <span class="status" data-tone="fail">failed</span>
        <span>
          <strong>Something didn't check out.</strong>
          {result?.error ?? `${failed.length} step${failed.length === 1 ? "" : "s"} failed; see below.`}
        </span>
      {:else if verdict === "pending"}
        <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>waiting</span>
        <span><strong>Waiting for Chainlink.</strong> The list is sealed; the random number hasn't arrived yet.</span>
      {:else}
        <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>checking</span>
        <span>Checked {done.length} of 4 steps…</span>
      {/if}
      {#if !running}<span class="notice-actions"><button class="btn small" onclick={run}>Check again</button></span>{/if}
    </div>

    {#if result}
      <ol class="chain">
        {#each result.steps as step, i (step.id)}
          {@const sw = stepWord(step.status)}
          <li class="link" data-state={step.status}>
            <span class="n" aria-hidden="true">{i + 1}</span>
            <div class="body flow">
              <div class="link-head">
                <h2>{step.title}</h2>
                <span class="status" data-tone={sw.tone}>
                  {#if sw.tone === "run"}<span class="live" aria-hidden="true"></span>{/if}{sw.word}
                </span>
              </div>
              <p class="prose summary">{step.summary}</p>
              {#if step.note}<p class="notice">{step.note}</p>{/if}

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
                  <table class="table reflow">
                    <caption>The shuffle, step by step</caption>
                    <thead>
                      <tr>
                        <th scope="col" class="num w-min">Step</th>
                        <th scope="col">Hash of (number, step)</th>
                        <th scope="col">Mod</th>
                        <th scope="col">Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each result.shuffle as s (s.step)}
                        <tr>
                          <td data-label="Step" class="num w-min">{s.step + 1}</td>
                          <td data-label="Hash" class="id">{s.hash.slice(0, 10)}…</td>
                          <td data-label="Mod">{s.step} + h mod {s.range} = {s.j}</td>
                          <td data-label="Winner">
                            <strong>{s.label}</strong> <span class="meta">No. {pad(s.position + 1)}</span>
                          </td>
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
        <section class="section">
          <div class="section-head">
            <h2>Find your entry</h2>
            <p>{result.entrants.length} sealed</p>
          </div>
          <div class="flow">
            <p class="lede">
              Search for a name or ticket, then ask the contract itself whether it was in the sealed list.
            </p>
            <div class="field search">
              <label for="q">Name or ticket</label>
              <input class="input" id="q" type="search" bind:value={query} autocomplete="off" />
            </div>
            {#if matches.length}
              <table class="table">
                <tbody>
                  {#each matches as m (m.index)}
                    <tr>
                      <td class="id w-min">{pad(m.index + 1)}</td>
                      <th scope="row">{m.label}</th>
                      <td class="w-min"><button class="btn small" onclick={() => checkEntry(m.index)}>Check on-chain</button></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else if query.trim()}
              <p class="meta">No entry matches "{query}".</p>
            {/if}
            {#if lookup}
              <p class="notice" data-tone={lookup.ok === null ? "run" : lookup.ok ? "ok" : "fail"} role="status">
                {#if lookup.ok === null}
                  <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>asking</span>
                  <span>Asking the contract about {lookup.label}…</span>
                {:else if lookup.ok}
                  <span class="status" data-tone="ok">confirmed</span>
                  <span>
                    The contract confirms <strong>{lookup.label}</strong> was in the sealed list
                    ({lookup.proof.length} hashes in the proof).
                  </span>
                {:else}
                  <span class="status" data-tone="fail">not found</span>
                  <span>The contract says this entry was not in the sealed list.</span>
                {/if}
              </p>
            {/if}
          </div>
        </section>
      {/if}

      <section class="section">
        <div class="section-head">
          <h2>Check it without this site</h2>
        </div>
        <ol class="prose diy">
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
        <hr />
      </section>
    {/if}
  {/if}
</article>

<style>
  .verdict {
    font-size: var(--fs-base);
    line-height: var(--lh);
    padding: var(--s-3) var(--gutter);
  }

  /* The chain of custody: numbered links ruled in ink, each with its state in words. */
  .chain {
    list-style: none;
    padding: 0;
    margin-top: calc(var(--lh) * 1.5);
    border-top: var(--rule-w) solid var(--rule);
    border-bottom: var(--rule-w) solid var(--rule);
  }
  .link {
    display: grid;
    grid-template-columns: 4ch minmax(0, 1fr);
    gap: 0 var(--gutter);
    padding: var(--lh) 0;
  }
  .link + .link {
    border-top: var(--hair-w) solid var(--line);
  }
  .link[data-state="fail"] {
    background: var(--fail-wash);
  }
  .n {
    font-size: var(--fs-lg);
    font-weight: var(--fw-heavy);
    line-height: var(--lh);
    text-align: right;
    color: var(--ink-3);
  }
  .link[data-state="pass"] .n {
    color: var(--ink);
  }
  .link[data-state="fail"] .n {
    color: var(--fail);
  }
  .body {
    min-width: 0;
    --flow-space: var(--s-3);
    padding-right: var(--cell-x);
  }
  .link-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-1) var(--gutter);
  }
  .summary {
    color: var(--ink-2);
  }
  .plan {
    border-top: var(--hair-w) solid var(--line);
    border-bottom: var(--hair-w) solid var(--line);
  }
  .plan li {
    padding-inline: 0;
  }
  .search {
    max-width: 48ch;
  }
  .diy {
    padding-left: 3ch;
  }
  .diy li + li {
    margin-top: var(--s-3);
  }
  @media (max-width: 40rem) {
    .link {
      grid-template-columns: 2ch minmax(0, 1fr);
      gap: 0 1.5ch;
    }
  }
</style>
