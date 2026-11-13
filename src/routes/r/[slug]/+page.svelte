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

  const statusWord = { open: "open", requested: "drawing", drawn: "drawn" } as const;
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
    <p class="cluster">
      <span class="status" data-tone={statusTone[raffle.status]}>
        {#if raffle.status === "requested"}<span class="live" aria-hidden="true"></span>{/if}{statusWord[raffle.status]}
      </span>
      <span class="meta">
        {raffle.winnerCount}
        {raffle.winnerCount === 1 ? "winner" : "winners"} · {data.entries.length}
        {data.entries.length === 1 ? "entry" : "entries"}
      </span>
    </p>
    {#if raffle.status === "open"}
      <button class="btn small" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
    {:else}
      <a class="btn small" href="/r/{raffle.slug}/verify">Verify</a>
    {/if}
  </div>

  {#if raffle.status === "drawn" && data.winners}
    <ol class="winners" aria-label={data.winners.length === 1 ? "Winner" : "Winners"} aria-live="polite">
      {#each data.winners as w, i (w.number)}
        <li style="--i: {i}"><Ticket size="lg" number={pad(w.number)} label={w.label} /></li>
      {/each}
    </ol>
  {:else if raffle.status === "requested"}
    <p class="notice block" data-tone="run" aria-live="polite">
      Waiting for Chainlink's number. This page updates when it arrives.
    </p>
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
          <textarea class="textarea" id="names" name="names" rows="3" placeholder="One per line, or comma-separated"
          ></textarea>
        </div>
        <div class="btn-row">
          <button class="btn">Add</button>
          {#if form?.added}<span class="status" data-tone="ok">added {form.added}</span>{/if}
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
            <button class="btn danger" disabled={drawing || short > 0}>
              {drawing ? "Sealing the list…" : "Draw now"}
            </button>
            <span class="hint">
              {#if short > 0 && !drawing}
                Needs {short} more {short === 1 ? "entry" : "entries"}.
              {:else}
                Final. Can't be undone or re-rolled.
              {/if}
            </span>
          </div>
        </form>
      {:else}
        <p class="hint">Draws aren't configured on this server.</p>
      {/if}
    </div>
  {/if}

  {#if data.entries.length === 0}
    <p class="meta block">Nobody's in yet.</p>
  {:else}
    <table class="table block">
      <caption class="sr-only">Entries</caption>
      <tbody>
        {#each data.entries as e (e.id)}
          <tr class:is-selected={e.mine}>
            <td class="id w-min meta">{pad(e.number)}</td>
            <th scope="row">{e.label}</th>
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

  .winners {
    list-style: none;
    padding: 0;
    margin-top: calc(var(--lh) * 1.5);
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
  .tags {
    display: flex;
    gap: 1ch;
  }
  .table td form {
    margin: 0;
  }
  .table tbody tr:first-child > * {
    border-top: var(--rule-w) solid var(--rule);
  }
</style>
