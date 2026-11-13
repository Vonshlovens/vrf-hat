<script lang="ts">
  import { enhance } from "$app/forms";
  import { refreshAll } from "$app/navigation";
  import { page } from "$app/state";
  import Ticket from "#lib/components/Ticket.svelte";

  let { data, form } = $props();
  let drawing = $state(false);
  let copied = $state(false);

  const pad = (n: number) => String(n).padStart(4, "0");
  const raffle = $derived(data.raffle);
  const shareUrl = $derived(page.url.origin + page.url.pathname);
  const short = $derived(Math.max(0, raffle.winnerCount - data.entries.length));
  const hostOpen = $derived(data.isHost && raffle.status === "open");

  const statusWord = { open: "taking entries", requested: "drawing", drawn: "drawn" } as const;
  const statusTone = { open: "idle", requested: "run", drawn: "ok" } as const;

  // While Chainlink works, poll until the random word lands.
  $effect(() => {
    if (raffle.status !== "requested") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/r/${raffle.slug}/status`);
      if (res.ok && (await res.json()).status === "drawn") refreshAll();
    }, 3000);
    return () => clearInterval(timer);
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
    <dl class="facts">
      <div>
        <dt>Status</dt>
        <dd>
          <span class="status" data-tone={statusTone[raffle.status]}>
            {#if raffle.status === "requested"}<span class="live" aria-hidden="true"></span>{/if}{statusWord[raffle.status]}
          </span>
        </dd>
      </div>
      <div><dt>Winners</dt><dd>{raffle.winnerCount}</dd></div>
      <div><dt>Entries</dt><dd>{data.entries.length}</dd></div>
    </dl>
    <div class="btn-row">
      {#if raffle.status === "open"}
        <button class="btn small" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
      {:else}
        <a class="btn small" href="/r/{raffle.slug}/verify">Verify the draw</a>
      {/if}
    </div>
  </div>

  {#if raffle.status === "drawn" && data.winners}
    <section class="section" aria-live="polite">
      <div class="section-head">
        <h2>{data.winners.length === 1 ? "The winner" : "The winners"}</h2>
        <p>Picked by Chainlink VRF</p>
      </div>
      <ol class="winners">
        {#each data.winners as w, i (w.number)}
          <li style="--i: {i}"><Ticket size="lg" number={pad(w.number)} label={w.label} /></li>
        {/each}
      </ol>
      <div class="btn-row">
        <a class="btn primary" href="/r/{raffle.slug}/verify">Check this draw yourself</a>
      </div>
    </section>
  {:else if raffle.status === "requested"}
    <div class="notice wait" data-tone="run" aria-live="polite">
      <span class="status" data-tone="run"><span class="live" aria-hidden="true"></span>waiting for Chainlink</span>
      <span>
        The list is sealed on-chain and a random number has been requested. It usually arrives within a
        minute; this page updates when it does.
      </span>
      <span class="notice-actions"><a href="/r/{raffle.slug}/verify">Follow along</a></span>
    </div>
  {/if}

  {#if raffle.status === "open"}
    <section class="enter">
      {#if !data.user}
        {#if raffle.selfEntry}
          <a class="btn primary" href="/login?next=/r/{raffle.slug}">Sign in to enter</a>
        {/if}
      {:else if data.entered}
        <p class="notice" data-tone="ok"><span class="status" data-tone="ok">entered</span> You're in. Good luck.</p>
      {:else if raffle.selfEntry || data.isHost}
        <form method="POST" action="?/enter" use:enhance class="inline">
          <div class="field grow">
            <label for="label">Your name in the hat</label>
            <input class="input" id="label" name="label" type="text" maxlength="64" value={data.user.name} />
          </div>
          <button class="btn primary">Enter the raffle</button>
        </form>
      {/if}
    </section>
  {/if}

  {#if form?.error}<p class="notice error" data-tone="fail" role="alert">{form.error}</p>{/if}

  {#if hostOpen}
    <section class="section">
      <div class="section-head">
        <h2>Host controls</h2>
        <p>Only you see this</p>
      </div>
      <div class="split">
        <form method="POST" action="?/addNames" use:enhance class="form">
          <div class="field">
            <label for="names">Add names</label>
            <textarea class="textarea" id="names" name="names" rows="4" aria-describedby="names-hint"></textarea>
            <p class="hint" id="names-hint">One per line, or separated by commas.</p>
          </div>
          <div class="btn-row">
            <button class="btn">Add to the hat</button>
            {#if form?.added}<span class="status" data-tone="ok">added {form.added}</span>{/if}
          </div>
        </form>

        <div class="flow draw">
          <h3>Draw the winners</h3>
          <p class="prose small-prose">
            Entries close and the list is sealed on the blockchain. This can't be undone, and the result
            can't be re-rolled.
          </p>
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
                <button class="btn danger" disabled={drawing || short > 0}>
                  {drawing ? "Sealing the list…" : "Draw now"}
                </button>
                {#if short > 0 && !drawing}
                  <span class="hint">Needs {short} more {short === 1 ? "entry" : "entries"} for {raffle.winnerCount} winners.</span>
                {/if}
              </div>
            </form>
          {:else}
            <p class="notice" data-tone="warn">
              <span class="status" data-tone="warn">unavailable</span> Draws aren't configured on this server (no contract
              or drawer key).
            </p>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  <section class="section">
    <div class="section-head">
      <h2>{raffle.status === "open" ? "In the hat" : "Entries"}</h2>
      <p>{data.entries.length} {data.entries.length === 1 ? "entry" : "entries"}</p>
    </div>
    {#if data.entries.length === 0}
      <div class="state">
        <h3>Nobody's in yet</h3>
        <p>{data.isHost ? "Add names above, or share the link." : "Share the link to get people in."}</p>
      </div>
    {:else}
      <table class="table">
        <thead>
          <tr>
            <th scope="col" class="w-min">No.</th>
            <th scope="col">Name</th>
            <th scope="col" class="w-min"><span class="sr-only">Notes</span></th>
            {#if hostOpen}<th scope="col" class="w-min"><span class="sr-only">Actions</span></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.entries as e (e.id)}
            <tr class:is-selected={e.mine}>
              <td data-label="No." class="id w-min">{pad(e.number)}</td>
              <th scope="row" data-label="Name">{e.label}</th>
              <td class="w-min">
                <span class="tags">
                  {#if e.won}<span class="status" data-tone="ok">winner</span>{/if}
                  {#if e.mine}<span class="status" data-tone="mark">you</span>{/if}
                </span>
              </td>
              {#if hostOpen}
                <td class="w-min">
                  <form method="POST" action="?/remove" use:enhance>
                    <input type="hidden" name="id" value={e.id} />
                    <button class="btn ghost small" aria-label="Remove {e.label}">Remove</button>
                  </form>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</article>

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--gutter);
  }
  .summary .facts {
    flex: 1 1 auto;
  }

  .winners {
    list-style: none;
    padding: 0;
    margin-bottom: var(--lh);
    display: grid;
    gap: var(--s-3);
    justify-items: start;
  }
  .winners li {
    max-width: 100%;
    animation: drop var(--dur-slow) var(--ease-out) both;
    animation-delay: calc(var(--i) * var(--dur-base));
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(calc(var(--s-2) * -1));
    }
  }

  .wait,
  .enter,
  .error {
    margin-top: calc(var(--lh) * 1.5);
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
  .small-prose {
    font-size: var(--fs-base);
    color: var(--ink-2);
  }
  .draw {
    --flow-space: var(--s-3);
  }
  .tags {
    display: flex;
    gap: 1ch;
  }
  .table td form {
    margin: 0;
  }
</style>
