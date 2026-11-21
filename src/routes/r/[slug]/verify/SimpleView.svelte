<!--
  The verify page for people who don't know what a blockchain is: four plain
  claims, each with a big state, and a label saying who vouches for it, your
  browser (read straight from the blockchain) or the app.
-->
<script module lang="ts">
export type MineCheck = {
  label: string;
  /** This entry's positions in the sealed list. */
  slots: number[];
  /** How many of those the contract was asked about. */
  asked: number;
  /** The contract's answer for all asked slots; null while asking. */
  ok: boolean | null;
  error?: string;
};
</script>

<script lang="ts">
  import Ticket from "#lib/components/Ticket.svelte";
  import type { VerifyResult } from "#lib/verify/run.ts";
  import { buildStory, gapText, pullsOf, ticketNumber, type StoryState } from "#lib/verify/story.ts";

  let {
    result,
    running,
    eliminate,
    mine,
    byHandHref,
    onagain,
  }: {
    result: VerifyResult | null;
    running: boolean;
    eliminate: boolean;
    mine: MineCheck | null;
    byHandHref: string;
    onagain: () => void;
  } = $props();

  const story = $derived(buildStory(result, running));
  const t = $derived(result?.timeline);
  const count = $derived(result?.entrants.length ?? 0);
  const pulls = $derived(pullsOf(t?.picks ?? [], result?.entrants ?? [], mine?.slots));
  const minePulled = $derived(pulls.filter((p) => p.mine).length);
  const pulledWord = $derived(eliminate ? "drawn out" : "pulled");
  const mineState = $derived<StoryState>(
    !mine
      ? "skip"
      : mine.error || mine.ok === false
        ? "fail"
        : mine.slots.length === 0
          ? "skip"
          : mine.ok
            ? "ok"
            : "run",
  );

  const when = (s: number | null | undefined) =>
    s == null ? null : new Date(s * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const MAX_PULLS = 40;

  const headline: Record<StoryState, string> = {
    ok: "This draw checks out",
    fail: "Something doesn't add up",
    run: "Checking the draw…",
    wait: "Waiting for the random number",
    skip: "This draw checks out",
  };
</script>

{#snippet mark(state: StoryState, big = false)}
  <span class="mark" class:big data-state={state} aria-hidden="true">
    {#if state === "ok"}
      <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    {:else if state === "fail"}
      <svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
    {:else if state === "skip"}
      <svg viewBox="0 0 24 24"><path d="M7 12h10" /></svg>
    {:else if state === "wait"}
      <svg viewBox="0 0 24 24"><path d="M12 7v5.5l3.5 2" /></svg>
    {:else}
      <span class="live"></span>
    {/if}
  </span>
{/snippet}

{#snippet browser(state: StoryState)}
  <p class="source" data-by="browser" data-state={state}>
    {#if state === "fail"}
      Your browser checked this against the blockchain and it doesn't match
    {:else if state === "run" || state === "wait"}
      Your browser is checking this against the blockchain
    {:else}
      Checked by your browser against the blockchain
    {/if}
  </p>
{/snippet}

{#snippet app(text: string)}
  <p class="source" data-by="app">{text}</p>
{/snippet}

<section class="simple" aria-labelledby="simple-title">
  <div class="verdict-card" data-state={story.verdict} role="status" aria-live="polite">
    {@render mark(story.verdict, true)}
    <div class="verdict-text">
      <h2 id="simple-title">{headline[story.verdict]}</h2>
      <p>
        {#if story.verdict === "ok"}
          Your browser just re-checked every step against the public blockchain itself, not through our server.
        {:else if story.verdict === "fail"}
          {result?.error ??
            "Your browser re-checked the draw against the public blockchain, and at least one step doesn't match. The details are below."}
        {:else if story.verdict === "wait"}
          The list is sealed. Chainlink usually answers within a minute or two; check again shortly.
        {:else}
          Your browser is reading the public blockchain directly and redoing each step.
        {/if}
      </p>
    </div>
    {#if !running}<button class="btn small again" onclick={onagain}>Check again</button>{/if}
  </div>

  <ol class="story">
    <li data-state={story.sealed}>
      {@render mark(story.sealed)}
      <div class="body">
        {#if t?.sealedAt}<p class="when">Sealed {when(t.sealedAt)}</p>{/if}
        <h3>The list was sealed before the draw</h3>
        {#if story.sealed === "fail"}
          <p>The list published here doesn't match the one recorded on the blockchain, or it wasn't recorded properly.</p>
        {:else if count}
          <p>
            {plural(count, "ticket")} went in. A fingerprint of the full list was recorded on the blockchain
            {t?.retried ? "before the number was asked for" : "at that moment"}, and the list published here still matches
            it exactly. Changing even one name would change the fingerprint.
          </p>
        {:else}
          <p class="quiet">Comparing the published list with the fingerprint on the blockchain…</p>
        {/if}
        {@render browser(story.sealed)}
      </div>
    </li>

    <li data-state={story.random}>
      {@render mark(story.random)}
      <div class="body">
        {#if t?.drawnAt}
          <p class="when">
            Arrived {when(t.drawnAt)}{#if t.sealedAt != null}, {gapText(t.drawnAt - t.sealedAt)} after sealing{/if}
          </p>
        {/if}
        {#if story.random === "skip"}
          <h3>The random number came from a test stand-in</h3>
        {:else}
          <h3>The random number came from Chainlink, not from us</h3>
        {/if}
        {#if story.random === "fail"}
          <p>The random number's proof didn't check out, or it didn't come from Chainlink.</p>
        {:else if story.random === "wait"}
          <p>Chainlink, an independent service, hasn't sent the number yet. Nobody, us included, knows what it will be.</p>
        {:else if story.random === "skip"}
          <p>
            This raffle runs on a test network, where a stand-in plays Chainlink's part, so there's no proof to check here.
            On the real network this step checks Chainlink's proof.
          </p>
        {:else}
          <p>
            Chainlink, an independent service, sent the number with a mathematical proof that the blockchain checks before
            accepting it. Nobody could see the number in advance or ask for a different one.
          </p>
        {/if}
        {#if story.random !== "skip"}{@render browser(story.random)}{/if}
        {#if t?.fulfilHref}
          <p class="small"><a href={t.fulfilHref} target="_blank" rel="noreferrer">See the number arrive on Basescan ↗</a></p>
        {/if}
      </div>
    </li>

    <li data-state={story.pulled}>
      {@render mark(story.pulled)}
      <div class="body">
        <h3>The tickets {pulledWord} follow from that number</h3>
        {#if story.pulled === "fail"}
          <p>Redoing the math in your browser gives different tickets from the ones on the blockchain.</p>
        {:else if story.pulled === "wait"}
          <p>Once the number arrives, a fixed public recipe turns it into the tickets {pulledWord}.</p>
        {:else if pulls.length}
          <p>
            A fixed public recipe turns the number into tickets. Your browser redid it and got the same
            {plural(pulls.length, "ticket")} as the blockchain{eliminate ? ", in this order:" : ":"}
          </p>
        {:else}
          <p class="quiet">Redoing the math…</p>
        {/if}
        {#if story.pulled !== "wait" && pulls.length}
          <ol class="pulls" aria-label="Tickets {pulledWord}">
            {#each pulls.slice(0, MAX_PULLS) as p (p.order)}
              <li class:own={p.mine}>
                <Ticket size="sm" tone={eliminate ? "plain" : "ticket"} number={p.number} label={p.label} />
              </li>
            {/each}
            {#if pulls.length > MAX_PULLS}
              <li class="meta">and {pulls.length - MAX_PULLS} more</li>
            {/if}
          </ol>
        {/if}
        {@render browser(story.pulled)}
      </div>
    </li>

    {#if mine}
      <li data-state={mineState}>
        {@render mark(mineState)}
        <div class="body">
          {#if mine.slots.length === 0}
            <h3>Your entry isn't in this round's list</h3>
            <p>
              That's expected if you joined after this round was sealed, or if your tickets came out in an earlier round.
            </p>
          {:else}
            <h3>Your {mine.slots.length === 1 ? "ticket was" : "tickets were"} in the list</h3>
            <p>
              {mine.label} held {plural(mine.slots.length, "ticket")} in this round:
              {mine.slots
                .slice(0, 6)
                .map((s) => `No. ${ticketNumber(s)}`)
                .join(", ")}{mine.slots.length > 6 ? `, and ${mine.slots.length - 6} more` : ""}.
              {#if mineState === "ok"}
                Your browser asked the blockchain about {mine.asked === mine.slots.length
                  ? mine.asked === 1
                    ? "it"
                    : "each one"
                  : `the first ${mine.asked}`}, and the sealed list includes {mine.asked === 1 ? "it" : "them"}.
              {:else if mineState === "fail"}
                {mine.error ?? "The blockchain says the sealed list doesn't include them."}
              {/if}
            </p>
            {#if minePulled && story.pulled === "ok"}
              <p class="own-note">
                {#if mine.slots.length === 1}
                  Your ticket was {pulledWord} this round.
                {:else}
                  {minePulled === 1 ? "One" : minePulled} of your tickets {minePulled === 1 ? "was" : "were"}
                  {pulledWord} this round.
                {/if}
              </p>
            {/if}
          {/if}
          {@render app("Which entry is yours is the app's word")}
          {#if mine.slots.length}{@render browser(mineState)}{/if}
        </div>
      </li>
    {/if}
  </ol>

  <div class="why">
    <h3>Why nobody could cheat</h3>
    <p>
      The list's fingerprint was recorded on the blockchain before the random number existed, so nobody, including
      whoever runs this site, could change the list or choose the result afterwards.
    </p>
  </div>

  <div class="yourself">
    <h3>Don't trust this page? Check it yourself</h3>
    <p>
      The checks above run in your browser and read the blockchain directly, but this page's code still comes from us.
      To leave us out entirely, look the draw up yourself:
    </p>
    <ul class="links">
      {#if t?.contractHref}
        <li><a href={t.contractHref} target="_blank" rel="noreferrer">The raffle's contract on Basescan ↗</a></li>
      {/if}
      {#if t?.requestHref}
        <li><a href={t.requestHref} target="_blank" rel="noreferrer">The transaction that sealed the list ↗</a></li>
      {/if}
      <li><a href={byHandHref}>Step-by-step guide to checking it by hand</a></li>
      <li><a href="/how#verify">How the draw works</a></li>
    </ul>
  </div>
</section>

<style>
  .simple {
    display: grid;
    gap: calc(var(--lh) * 1.5);
  }
  h2,
  h3 {
    margin: 0;
  }

  /* ------------------------------------------------------------ verdict */
  .verdict-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3) var(--gutter);
    padding: var(--s-5) var(--gutter);
    border: var(--rule-w) solid var(--rule);
    background: var(--paper-raised);
  }
  .verdict-card[data-state="ok"] {
    background: var(--ok-wash);
    border-color: var(--ok);
  }
  .verdict-card[data-state="fail"] {
    background: var(--fail-wash);
    border-color: var(--fail);
  }
  .verdict-card[data-state="run"],
  .verdict-card[data-state="wait"] {
    background: var(--run-wash);
    border-color: var(--run-line);
  }
  .verdict-text {
    display: grid;
    gap: var(--s-1);
  }
  .verdict-text h2 {
    font-size: var(--fs-xl);
    line-height: 1.2;
    font-weight: var(--fw-heavy);
    letter-spacing: var(--tracking-title);
  }
  .verdict-text p {
    color: var(--ink-2);
    max-width: 60ch;
  }
  @media (max-width: 40rem) {
    .verdict-card {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
    }
    .again {
      grid-column: 2;
      justify-self: start;
    }
  }

  /* --------------------------------------------------------------- marks */
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: var(--rule-w) solid var(--line-strong);
    background: var(--paper);
    color: var(--ink-3);
  }
  .mark.big {
    width: 3.25rem;
    height: 3.25rem;
  }
  .mark svg {
    width: 70%;
    height: 70%;
    fill: none;
    stroke: currentColor;
    stroke-width: 3;
    stroke-linecap: square;
  }
  .mark[data-state="ok"] {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--paper);
  }
  .mark[data-state="fail"] {
    background: var(--fail);
    border-color: var(--fail);
    color: var(--paper);
  }
  .mark[data-state="run"],
  .mark[data-state="wait"] {
    background: var(--run-wash);
    border-color: var(--run);
    color: var(--run);
  }
  .mark[data-state="skip"] {
    border-style: dashed;
  }

  /* --------------------------------------------------------------- story */
  .story {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
  }
  .story > li {
    position: relative;
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: 0 var(--gutter);
    padding-bottom: calc(var(--lh) * 1.25);
  }
  /* The rail joining one step to the next: the order is the point. */
  .story > li:not(:last-child)::before {
    content: "";
    position: absolute;
    left: calc(1rem - var(--rule-w) / 2);
    top: 2rem;
    bottom: 0;
    width: var(--rule-w);
    background: var(--line);
  }
  .story > li[data-state="ok"]:not(:last-child)::before {
    background: var(--ok-line);
  }
  .body {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
    padding-top: var(--s-1);
  }
  .body h3 {
    font-size: var(--fs-lg);
    line-height: 1.25;
  }
  .body p {
    max-width: 66ch;
  }
  .body > p:not(.when, .source, .small) {
    font-family: var(--font-prose);
    font-size: var(--fs-md);
    line-height: var(--lh-prose);
    color: var(--ink-2);
  }
  .when {
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .quiet {
    font-style: italic;
  }

  /* Who vouches for a line: your browser (from the chain) or the app. */
  .source {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 1ch;
    padding: var(--s-1) 1ch;
    font-size: var(--fs-sm);
    line-height: var(--lh-tight);
    font-weight: var(--fw-bold);
  }
  .source[data-by="browser"] {
    color: var(--ok);
    background: var(--ok-wash);
    box-shadow: inset 0 0 0 var(--hair-w) var(--ok-line);
  }
  .source[data-by="browser"]::before {
    content: "✓";
  }
  .source[data-by="browser"][data-state="run"],
  .source[data-by="browser"][data-state="wait"] {
    color: var(--run);
    background: var(--run-wash);
    box-shadow: inset 0 0 0 var(--hair-w) var(--run-line);
    font-style: italic;
  }
  .source[data-by="browser"][data-state="run"]::before,
  .source[data-by="browser"][data-state="wait"]::before {
    content: "…";
  }
  .source[data-by="browser"][data-state="fail"] {
    color: var(--fail);
    background: var(--fail-wash);
    box-shadow: inset 0 0 0 var(--hair-w) var(--fail-line);
  }
  .source[data-by="browser"][data-state="fail"]::before {
    content: "✗";
  }
  .source[data-by="app"] {
    color: var(--ink-3);
    font-weight: var(--fw-medium);
    box-shadow: inset 0 0 0 var(--hair-w) var(--line-strong);
    background-image: none;
  }
  .source[data-by="app"]::before {
    content: "i";
    display: grid;
    place-items: center;
    width: 1.1em;
    height: 1.1em;
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    font-style: italic;
    border: var(--hair-w) solid currentColor;
  }

  .pulls {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) 1ch;
  }
  .pulls li {
    min-width: 0;
    max-width: 100%;
  }
  .pulls li.own {
    outline: var(--rule-w) solid var(--mark);
    outline-offset: 2px;
  }
  .own-note {
    font-weight: var(--fw-bold);
    color: var(--ink);
  }

  /* --------------------------------------------------- why / do it yourself */
  .why,
  .yourself {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-4) var(--gutter);
    border-top: var(--rule-w) solid var(--rule);
  }
  .why {
    background: var(--paper-sunk);
  }
  .why h3,
  .yourself h3 {
    font-size: var(--fs-base);
  }
  .why p,
  .yourself p {
    font-family: var(--font-prose);
    font-size: var(--fs-md);
    line-height: var(--lh-prose);
    color: var(--ink-2);
    max-width: 66ch;
  }
  .links {
    display: grid;
    gap: var(--s-1);
    padding-left: 2ch;
    margin: 0;
  }
</style>
