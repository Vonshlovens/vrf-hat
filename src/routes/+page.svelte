<script lang="ts">
  import Ticket from "#lib/components/Ticket.svelte";
  let { data } = $props();

  const statusText = { open: "Taking entries", requested: "Drawing", drawn: "Drawn" } as const;
</script>

<svelte:head><title>VRF Hat</title></svelte:head>

<section class="wrap hero">
  <div class="hat" aria-hidden="true">
    <Ticket number="0007" label="Priya" />
    <Ticket number="0012" label="Sam O." tone="plain" />
    <Ticket number="0031" label="Mateus" tone="plain" />
  </div>
  <h1>Pull names from a hat that anyone can check.</h1>
  <p class="lede">
    Collect entries, then let Chainlink's verifiable randomness pick the winners. Every step is
    recorded on a public blockchain, so nobody has to take your word that the draw was fair.
  </p>
  <a class="button" href={data.user ? "/new" : "/login?next=/new"}>Start a raffle</a>
</section>

{#if data.hosted.length}
  <section class="wrap mine">
    <h2>Your raffles</h2>
    <ul>
      {#each data.hosted as { raffle, entrants } (raffle.id)}
        <li>
          <a href="/r/{raffle.slug}">{raffle.title}</a>
          <span class="muted">{statusText[raffle.status]}, {entrants} {entrants === 1 ? "entry" : "entries"}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="wrap steps">
  <h2>How a draw works</h2>
  <ol>
    <li>
      <h3>The list is sealed</h3>
      <p>
        When you start the draw, entries close and a fingerprint of the full list (a Merkle root) is
        written to the blockchain. Changing a single name afterwards would change the fingerprint.
      </p>
    </li>
    <li>
      <h3>Chainlink picks a number</h3>
      <p>
        In the same transaction, the raffle asks Chainlink VRF for a random number. It arrives with a
        cryptographic proof that the chain checks before accepting it. Nobody, including us, can see
        the number in advance or ask for another one.
      </p>
    </li>
    <li>
      <h3>Anyone can redo the math</h3>
      <p>
        Winners follow from the number by a fixed public formula. Each raffle has a verify page that
        re-checks every step in your browser against the blockchain, without trusting this site.
      </p>
    </li>
  </ol>
</section>

<style>
  .hero {
    padding-top: 3.5rem;
    padding-bottom: 3rem;
  }
  .hat {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 2.25rem;
  }
  .hat :global(.ticket:nth-child(1)) {
    transform: rotate(-3deg);
  }
  .hat :global(.ticket:nth-child(2)) {
    transform: rotate(2deg) translateY(6px);
  }
  .hat :global(.ticket:nth-child(3)) {
    transform: rotate(-1deg);
  }
  h1 {
    font-size: clamp(2.2rem, 6vw, 3.4rem);
    max-width: 14em;
  }
  .lede {
    font-size: var(--t-md);
    line-height: 1.45;
    color: var(--ink-soft);
    margin-bottom: 1.75rem;
  }
  .mine ul {
    list-style: none;
    padding: 0;
    margin: 0 0 3rem;
  }
  .mine li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--rule);
  }
  .mine a {
    font-weight: 600;
  }
  .steps {
    padding-top: 2rem;
    border-top: 1px solid var(--rule);
  }
  .steps ol {
    list-style: none;
    padding: 0;
    margin: 1.5rem 0 0;
    counter-reset: step;
  }
  .steps li {
    counter-increment: step;
    position: relative;
    padding-left: 3rem;
    margin-bottom: 1.5rem;
  }
  .steps li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 0.05rem;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1.5px solid var(--ink);
    font-weight: 700;
  }
  .steps h3 {
    margin-bottom: 0.3em;
  }
</style>
