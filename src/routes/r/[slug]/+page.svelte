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

<article class="wrap">
  <header class="head">
    <h1>{raffle.title}</h1>
    {#if raffle.description}<p class="desc">{raffle.description}</p>{/if}
    <p class="muted meta">
      {raffle.winnerCount}
      {raffle.winnerCount === 1 ? "winner" : "winners"} from {data.entries.length}
      {data.entries.length === 1 ? "entry" : "entries"}
      {#if raffle.status === "open"}
        <button class="quiet share" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
      {/if}
    </p>
  </header>

  {#if raffle.status === "drawn" && data.winners}
    <section class="result" aria-live="polite">
      <h2>{data.winners.length === 1 ? "The winner" : "The winners"}</h2>
      <ol class="winners">
        {#each data.winners as w, i (w.number)}
          <li style="--i: {i}"><Ticket size="lg" number={pad(w.number)} label={w.label} /></li>
        {/each}
      </ol>
      <a class="button" href="/r/{raffle.slug}/verify">Check this draw yourself</a>
    </section>
  {:else if raffle.status === "requested"}
    <section class="waiting" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <div>
        <h2>Waiting for Chainlink</h2>
        <p>
          The list is sealed on-chain and a random number has been requested. It usually arrives within
          a minute; this page updates when it does.
        </p>
        <a href="/r/{raffle.slug}/verify">Follow along on the verify page</a>
      </div>
    </section>
  {/if}

  {#if raffle.status === "open"}
    <section class="enter">
      {#if !data.user}
        {#if raffle.selfEntry}
          <a class="button" href="/login?next=/r/{raffle.slug}">Sign in to enter</a>
        {/if}
      {:else if data.entered}
        <p class="in">You're in. Good luck.</p>
      {:else if raffle.selfEntry || data.isHost}
        <form method="POST" action="?/enter" use:enhance class="inline">
          <div class="grow">
            <label for="label">Your name in the hat</label>
            <input id="label" name="label" type="text" maxlength="64" value={data.user.name} />
          </div>
          <button>Enter the raffle</button>
        </form>
      {/if}
    </section>
  {/if}

  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

  {#if data.isHost && raffle.status === "open"}
    <section class="host">
      <h2>Host controls</h2>
      <form method="POST" action="?/addNames" use:enhance>
        <div class="field">
          <label for="names">Add names <span class="hint">one per line, or separated by commas</span></label>
          <textarea id="names" name="names" rows="4"></textarea>
        </div>
        <button class="secondary">Add to the hat</button>
        {#if form?.added}<span class="muted added">Added {form.added}.</span>{/if}
      </form>

      <div class="draw">
        <h3>Draw the winners</h3>
        <p>
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
            <button disabled={drawing || data.entries.length < raffle.winnerCount}>
              {drawing ? "Sealing the list…" : "Draw now"}
            </button>
          </form>
        {:else}
          <p class="error">Draws aren't configured on this server (no contract or drawer key).</p>
        {/if}
      </div>
    </section>
  {/if}

  <section class="hat">
    <h2>{raffle.status === "open" ? "In the hat" : "Entries"}</h2>
    {#if data.entries.length === 0}
      <p class="muted">
        Nobody's in yet. {data.isHost ? "Add names above, or share the link." : "Share the link to get people in."}
      </p>
    {:else}
      <ul>
        {#each data.entries as e (e.id)}
          <li class:mine={e.mine}>
            <Ticket size="sm" number={pad(e.number)} label={e.label} tone={e.won ? "ticket" : "plain"} />
            {#if data.isHost && raffle.status === "open"}
              <form method="POST" action="?/remove" use:enhance>
                <input type="hidden" name="id" value={e.id} />
                <button class="quiet" aria-label="Remove {e.label}">Remove</button>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</article>

<style>
  .head {
    padding-top: 2rem;
    margin-bottom: 2rem;
  }
  .desc {
    font-size: var(--t-md);
  }
  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .share {
    color: var(--cobalt);
  }

  .result {
    margin: 0 0 3rem;
  }
  .winners {
    list-style: none;
    padding: 0;
    margin: 1rem 0 2rem;
    display: grid;
    gap: 0.9rem;
    justify-items: start;
  }
  .winners li {
    animation: drop 520ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    animation-delay: calc(var(--i) * 140ms);
    max-width: 100%;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-18px) rotate(-4deg);
    }
  }

  .waiting {
    display: flex;
    gap: 1.25rem;
    align-items: flex-start;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2.5rem;
    background: var(--surface);
    border-left: 4px solid var(--ticket);
  }
  .spinner {
    flex: none;
    width: 1.6rem;
    height: 1.6rem;
    margin-top: 0.2rem;
    border-radius: 50%;
    border: 3px solid var(--rule);
    border-top-color: var(--ink);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .enter {
    margin-bottom: 2rem;
  }
  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: flex-end;
  }
  .grow {
    flex: 1 1 14rem;
  }
  .in {
    font-weight: 600;
  }

  .host {
    padding: 1.5rem 0;
    margin-bottom: 1rem;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .added {
    margin-left: 0.75rem;
  }
  .draw {
    margin-top: 2rem;
  }

  .hat {
    margin-top: 2rem;
  }
  .hat ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.6rem;
  }
  .hat li {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
  }
  .hat li form {
    margin: 0;
  }
  .hat li.mine :global(.ticket) {
    outline: 2px solid var(--cobalt);
    outline-offset: 2px;
  }
</style>
