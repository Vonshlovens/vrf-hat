<script lang="ts">
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import { refreshAll } from "$app/navigation";
  import { page } from "$app/state";
  import Ticket from "#lib/components/Ticket.svelte";
  import { describeRepeat } from "#lib/draw/schedule.ts";

  let { data, form } = $props();
  let drawing = $state(false);
  let copied = $state(false);
  let browserZone = $state("");
  // Set when a scheduled draw's time arrives while the page is open.
  let dueNow = $state(false);

  const raffle = $derived(data.raffle);
  const eliminate = $derived(raffle.mode === "eliminate");
  const shareUrl = $derived(page.url.origin + page.url.pathname);
  const hostOpen = $derived(data.isHost && raffle.status === "open");
  const scheduled = $derived(raffle.nextDrawAt !== null);
  const doneRounds = $derived(data.rounds.filter((r) => r.done));
  const roundNumber = $derived(data.rounds.length + 1);
  const survivors = $derived(data.entries.filter((e) => e.left > 0));
  const numbered = $derived(data.entries.some((e) => e.numbers !== null));
  const zone = $derived(raffle.timezone ?? browserZone);
  // svelte-ignore state_referenced_locally
  let timing = $state(scheduled ? "scheduled" : "manual");

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const noun = $derived(eliminate ? "elimination" : "winner");

  // A single draw counts every ticket entered; a repeating one counts what's in the hat now.
  const hatText = $derived.by(() => {
    const tickets = raffle.recurring ? data.hat.tickets : data.entries.reduce((sum, e) => sum + e.count, 0);
    const names = raffle.recurring ? data.hat.names : data.entries.length;
    const text = names === tickets ? plural(tickets, "ticket") : `${plural(tickets, "ticket")}, ${plural(names, "name")}`;
    return raffle.recurring && data.rounds.length ? `${text} in the hat` : text;
  });

  const statusWord = $derived(
    raffle.status === "requested" ? "drawing" : raffle.status === "drawn" ? (raffle.recurring ? "finished" : "drawn") : "open",
  );
  const statusTone = { open: "idle", requested: "run", drawn: "ok" } as const;

  const rule = $derived.by(() => {
    const parts = [`${plural(raffle.winnerCount, noun)}${raffle.recurring ? " per draw" : ""}`];
    if (raffle.repeatEvery && raffle.repeatUnit) parts.push(describeRepeat(raffle.repeatEvery, raffle.repeatUnit));
    if (raffle.recurring && eliminate) parts.push(`until ${raffle.keepCount} left`);
    if (raffle.maxDraws) parts.push(`${plural(raffle.maxDraws, "draw")} at most`);
    return parts.join(" · ");
  });

  onMount(() => {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  // Wake up when a scheduled draw comes due.
  $effect(() => {
    dueNow = false;
    if (raffle.status !== "open" || !raffle.nextDrawAt) return;
    const wait = new Date(raffle.nextDrawAt).getTime() - Date.now();
    // setTimeout can't wait longer than about 24 days.
    const timer = setTimeout(() => (dueNow = true), Math.min(Math.max(wait, 0), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  });

  // While Chainlink works, or a scheduled draw is due, ask the server until something changes.
  $effect(() => {
    const waiting = raffle.status === "requested";
    if (!waiting && !dueNow) return;
    const before = `${raffle.status} ${raffle.nextDrawAt}`;
    let stopped = false;
    const timer = setInterval(
      async () => {
        const res = await fetch(`/r/${raffle.slug}/status`).catch(() => null);
        if (stopped || !res?.ok) return;
        const now = await res.json();
        if (`${now.status} ${now.nextDrawAt}` !== before) refreshAll();
      },
      waiting ? 3000 : 5000,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
    setTimeout(() => (copied = false), 1800);
  }
</script>

<svelte:head><title>{raffle.title} | VRF Hat</title></svelte:head>

<article class="page">
  <header class="page-head">
    <h1>{raffle.title}</h1>
    {#if raffle.description}<p class="lede">{raffle.description}</p>{/if}
  </header>

  <div class="summary">
    <p class="cluster">
      <span class="status" data-tone={statusTone[raffle.status]}>
        {#if raffle.status === "requested"}<span class="live" aria-hidden="true"></span>{/if}{statusWord}
      </span>
      <span class="meta">{rule} · {hatText}</span>
    </p>
    {#if raffle.status === "open"}
      <button class="btn small" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
    {:else if !raffle.recurring}
      <a class="btn small" href="/r/{raffle.slug}/verify">Verify</a>
    {/if}
  </div>

  {#if raffle.status === "open" && raffle.nextDrawText}
    <p class="next block">
      <span class="status" data-tone={dueNow ? "run" : "idle"}>
        {#if dueNow}<span class="live" aria-hidden="true"></span>{/if}{dueNow ? "due" : "next draw"}
      </span>
      <time datetime={raffle.nextDrawAt}>{raffle.nextDrawText}</time>
      {#if data.nextPicks === 0}
        <span class="hint">
          {eliminate ? "Nothing to eliminate yet; it will be skipped." : "The hat is empty; it will be skipped."}
        </span>
      {/if}
    </p>
  {/if}

  {#if raffle.status === "requested"}
    <p class="notice block" data-tone="run" aria-live="polite">
      {raffle.recurring ? `Round ${data.rounds.length}: waiting` : "Waiting"} for Chainlink's number. This page updates
      when it arrives.
    </p>
  {/if}

  {#if raffle.status === "drawn" && eliminate && survivors.length > 0 && survivors.length <= 12}
    <section class="block" aria-live="polite">
      <h2 class="h3 label">Left standing</h2>
      <ol class="tickets big">
        {#each survivors as e, i (e.id)}
          <li style="--i: {i}"><Ticket size="lg" label={e.label} stub={e.left > 1 ? `×${e.left}` : undefined} /></li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if !raffle.recurring && doneRounds.length}
    <section class="block" aria-live="polite">
      {#if eliminate}<h2 class="h3 label">Eliminated</h2>{/if}
      <ol class="tickets big" aria-label={eliminate ? "Eliminated" : "Winners"}>
        {#each doneRounds[0].pulled as w, i (w.number)}
          <li style="--i: {i}">
            <Ticket size={eliminate ? "md" : "lg"} tone={eliminate ? "plain" : "ticket"} number={w.number} label={w.label} />
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if raffle.status === "open"}
    <div class="block">
      {#if !data.user}
        {#if raffle.selfEntry}
          <a class="btn primary" href="/login?next=/r/{raffle.slug}">Sign in to enter</a>
        {/if}
      {:else if data.entered}
        <p><span class="status" data-tone="ok">entered</span></p>
      {:else if raffle.selfEntry || data.isHost}
        <form method="POST" action="?/enter" use:enhance class="inline">
          <div class="field grow">
            <label for="label">Your name</label>
            <input class="input" id="label" name="label" type="text" maxlength="64" value={data.user.name} />
          </div>
          <button class="btn primary">Enter</button>
        </form>
      {/if}
    </div>
  {/if}

  {#if form?.error}<p class="notice block" data-tone="fail" role="alert">{form.error}</p>{/if}

  {#if hostOpen}
    <div class="block host">
      <form method="POST" action="?/addNames" use:enhance class="form">
        <div class="field">
          <label for="names">Add names</label>
          <textarea
            class="textarea"
            id="names"
            name="names"
            rows="3"
            placeholder="One per line, or comma-separated"
            aria-describedby="names-hint"
          ></textarea>
          <p class="hint" id="names-hint">For extra tickets, end the line with a count: <code>Dev Patel x3</code></p>
        </div>
        <div class="btn-row">
          <button class="btn">Add</button>
          {#if form?.added}
            <span class="status" data-tone="ok">
              added {plural(form.added.names, "name")}{#if form.added.tickets !== form.added.names}, {plural(form.added.tickets, "ticket")}{/if}
            </span>
          {/if}
        </div>
      </form>

      {#if data.drawsEnabled}
        <form
          method="POST"
          action="?/draw"
          use:enhance={() => {
            drawing = true;
            return async ({ update }) => {
              await update();
              drawing = false;
            };
          }}
        >
          <div class="btn-row">
            <button class="btn danger" disabled={drawing || data.nextPicks === 0}>
              {#if drawing}
                Sealing the list…
              {:else if raffle.recurring}
                Draw round {roundNumber} now
              {:else}
                Draw now
              {/if}
            </button>
            <span class="hint">
              {#if drawing}
                Sending it to the blockchain.
              {:else if data.nextPicks === 0}
                {#if !raffle.recurring}
                  Needs {plural(raffle.winnerCount - data.hat.tickets, "more ticket")}.
                {:else if eliminate}
                  Needs more than {plural(raffle.keepCount, "name")} in the hat.
                {:else}
                  The hat is empty.
                {/if}
              {:else if raffle.recurring}
                Pulls {plural(data.nextPicks, "ticket")}. Can't be undone or re-rolled.
              {:else}
                Final. Can't be undone or re-rolled.
              {/if}
            </span>
          </div>
        </form>
      {:else}
        <p class="hint">Draws aren't configured on this server.</p>
      {/if}

      {#if raffle.recurring}
        <details class="more" open={Boolean(form?.scheduled)}>
          <summary class="small">Schedule</summary>
          <form method="POST" action="?/schedule" use:enhance class="form sched">
            <fieldset class="segmented">
              <legend>When to draw</legend>
              <label>
                <input type="radio" name="timing" value="scheduled" bind:group={timing} /><span>On a schedule</span>
              </label>
              <label>
                <input type="radio" name="timing" value="manual" bind:group={timing} /><span>Whenever I say</span>
              </label>
            </fieldset>
            {#if timing === "scheduled"}
              <div class="field">
                <label for="firstDrawAt">Next draw</label>
                <input
                  class="input when"
                  id="firstDrawAt"
                  name="firstDrawAt"
                  type="datetime-local"
                  required
                  value={raffle.nextDrawLocal}
                  aria-describedby="tz-hint"
                />
                <p class="hint" id="tz-hint">{zone ? `${zone} time.` : "Your local time."}</p>
              </div>
              <div class="field">
                <label for="repeatEvery">Then every</label>
                <div class="every">
                  <input
                    class="input num count"
                    id="repeatEvery"
                    name="repeatEvery"
                    type="number"
                    min="1"
                    max="365"
                    required
                    value={raffle.repeatEvery ?? 1}
                  />
                  <select class="select unit" name="repeatUnit" aria-label="Unit" value={raffle.repeatUnit ?? "week"}>
                    <option value="hour">hours</option>
                    <option value="day">days</option>
                    <option value="week">weeks</option>
                  </select>
                </div>
              </div>
            {/if}
            <input type="hidden" name="timezone" value={zone} />
            <div class="btn-row">
              <button class="btn">Save schedule</button>
              {#if form?.scheduled}<span class="status" data-tone="ok">saved</span>{/if}
            </div>
          </form>
          <form
            method="POST"
            action="?/end"
            use:enhance
            onsubmit={(e) => {
              if (!confirm("End this raffle? There will be no more draws.")) e.preventDefault();
            }}
          >
            <div class="btn-row">
              <button class="btn ghost">End raffle</button>
              <span class="hint">No more draws. The rounds so far stand.</span>
            </div>
          </form>
        </details>
      {/if}
    </div>
  {/if}

  {#if raffle.recurring && data.rounds.length}
    <section class="block">
      <h2 class="h3 label">Rounds</h2>
      <ol class="rounds" reversed>
        {#each data.rounds.toReversed() as r (r.round)}
          <li>
            <div class="round-head">
              <span class="round-n">Round {r.round}</span>
              {#if r.done}
                <span class="meta">{r.when} · {plural(r.tickets ?? 0, "ticket")} in the hat</span>
              {:else}
                <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>drawing</span>
              {/if}
              <a class="small verify" href="/r/{raffle.slug}/verify?round={r.round}">Verify</a>
            </div>
            {#if r.pulled.length}
              <ul class="tickets" aria-label={eliminate ? "Eliminated" : "Winners"}>
                {#each r.pulled as w (w.number)}
                  <li><Ticket size="sm" tone={eliminate ? "plain" : "ticket"} number={w.number} label={w.label} /></li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if data.entries.length === 0}
    <p class="meta block">Nobody's in yet.</p>
  {:else}
    <div class="table-wrap block">
    <table class="table">
      <caption class="sr-only">Entries</caption>
      <tbody>
        {#each data.entries as e (e.id)}
          <tr class:is-selected={e.mine} class:gone={e.out} class:host-row={hostOpen}>
            {#if numbered}<td class="id w-min meta">{e.numbers ?? "—"}</td>{/if}
            <th scope="row">{e.label}</th>
            <td class="w-min num meta">
              {#if raffle.status !== "drawn" && e.left > 0 && e.left < e.count}
                {e.left} of {e.count} left
              {:else if e.count > 1}
                ×{e.count}
              {/if}
            </td>
            <td class="w-min">
              <span class="tags">
                {#if e.out}
                  <span class="status" data-tone="fail">out</span>
                {:else if !eliminate && e.picked > 0}
                  <span class="status" data-tone="ticket">{e.picked > 1 ? `winner ×${e.picked}` : "winner"}</span>
                {:else if eliminate && raffle.status === "drawn"}
                  <span class="status" data-tone="ticket">still in</span>
                {/if}
                {#if e.mine}<span class="status" data-tone="mark">you</span>{/if}
              </span>
            </td>
            {#if hostOpen}
              <td class="w-min actions">
                <span class="row-actions">
                  <form method="POST" action="?/setCount" use:enhance class="tickets-form">
                    <input type="hidden" name="id" value={e.id} />
                    <input
                      class="input num qty"
                      name="count"
                      type="number"
                      min="1"
                      max="1000"
                      required
                      value={e.count}
                      aria-label="Tickets for {e.label}"
                    />
                    <button class="btn ghost small">Set</button>
                  </form>
                  <form method="POST" action="?/remove" use:enhance>
                    <input type="hidden" name="id" value={e.id} />
                    <button class="btn ghost small" aria-label="Remove {e.label}">Remove</button>
                  </form>
                </span>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    </div>
  {/if}
</article>

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--gutter);
    padding-bottom: var(--s-2);
    border-bottom: var(--rule-w) solid var(--rule);
  }
  .summary .cluster {
    gap: var(--s-1) 1.5ch;
  }
  .block {
    margin-top: calc(var(--lh) * 1.5);
  }
  .next {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) 1.5ch;
  }
  .label {
    margin-bottom: var(--s-2);
  }

  .tickets {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .tickets li {
    max-width: 100%;
  }
  .tickets.big {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
  }
  .tickets.big li {
    animation: drop var(--dur-slow) var(--ease-out) both;
    animation-delay: calc(var(--i) * var(--dur-base));
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(calc(var(--s-2) * -1));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tickets.big li {
      animation: none;
    }
  }

  .rounds {
    list-style: none;
    padding: 0;
    border-top: var(--rule-w) solid var(--rule);
  }
  .rounds > li {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3) 0;
    border-bottom: var(--hair-w) solid var(--line);
  }
  .round-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) 1.5ch;
  }
  .round-n {
    font-weight: var(--fw-bold);
  }
  .verify {
    margin-left: auto;
  }

  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) 1.5ch;
    align-items: flex-end;
  }
  .grow {
    flex: 1 1 24ch;
    max-width: 48ch;
  }
  .host {
    display: grid;
    gap: var(--lh);
    max-width: 60ch;
  }
  .more summary {
    width: fit-content;
    cursor: pointer;
    color: var(--ink-3);
  }
  .more summary:hover {
    color: var(--ink);
  }
  .more form {
    margin-top: var(--lh);
  }
  .sched .segmented {
    justify-self: start;
  }
  .when {
    max-width: 28ch;
  }
  .count {
    max-width: 12ch;
  }
  .every {
    display: flex;
    gap: 1ch;
  }
  .unit {
    width: auto;
  }

  .tags {
    display: flex;
    gap: 1ch;
    white-space: nowrap;
  }
  .gone th {
    color: var(--ink-3);
    text-decoration: line-through;
  }
  .row-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1ch;
  }
  .tickets-form {
    display: flex;
    align-items: center;
    gap: 0.5ch;
  }
  .qty {
    width: 9ch;
    min-height: 1.75rem;
  }
  /* On a phone the host's controls drop to their own line under the name. */
  @media (max-width: 40rem) {
    .host-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      border-bottom: var(--hair-w) solid var(--line);
    }
    .host-row > * {
      flex: none;
      width: auto;
      border: 0;
    }
    .host-row > th {
      flex: 1 1 0;
      min-width: 0;
    }
    .host-row > .actions {
      flex: 0 0 100%;
      padding-top: 0;
    }
    .host-row .row-actions {
      justify-content: flex-start;
    }
    .table tbody tr.host-row:first-child > * {
      border-top: 0;
    }
    .table tbody tr.host-row:first-child {
      border-top: var(--rule-w) solid var(--rule);
    }
    .table tbody tr.host-row:last-child > * {
      border-bottom: 0;
    }
    .table tbody tr.host-row:last-child {
      border-bottom: var(--rule-w) solid var(--rule);
    }
  }
  .table td form {
    margin: 0;
  }
  .table tbody tr:first-child > * {
    border-top: var(--rule-w) solid var(--rule);
  }
</style>
