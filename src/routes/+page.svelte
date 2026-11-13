<script lang="ts">
  import Ticket from "#lib/components/Ticket.svelte";
  let { data } = $props();

  const statusWord = { open: "taking entries", requested: "drawing", drawn: "drawn" } as const;
  const statusTone = { open: "idle", requested: "run", drawn: "ok" } as const;
</script>

<svelte:head><title>VRF Hat</title></svelte:head>

<div class="page">
  <section class="hero">
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
    <div class="btn-row">
      <a class="btn primary" href={data.user ? "/new" : "/login?next=/new"}>Start a raffle</a>
    </div>
  </section>

  {#if data.hosted.length}
    <section class="section">
      <div class="section-head">
        <h2>Your raffles</h2>
        <p>{data.hosted.length} hosted</p>
      </div>
      <table class="table rows reflow">
        <thead>
          <tr>
            <th scope="col">Raffle</th>
            <th scope="col" class="w-min">Status</th>
            <th scope="col" class="num w-min">Entries</th>
          </tr>
        </thead>
        <tbody>
          {#each data.hosted as { raffle, entrants } (raffle.id)}
            <tr>
              <td data-label="Raffle"><a class="row-link" href="/r/{raffle.slug}">{raffle.title}</a></td>
              <td data-label="Status" class="w-min">
                <span class="status" data-tone={statusTone[raffle.status]}>
                  {#if raffle.status === "requested"}<span class="live" aria-hidden="true"></span>{/if}{statusWord[raffle.status]}
                </span>
              </td>
              <td data-label="Entries" class="num w-min">{entrants}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section class="section">
    <div class="section-head">
      <h2>How a draw works</h2>
    </div>
    <ol class="steps how">
      <li>
        <span class="step-name">The list is sealed</span>
        <span class="step-note">
          When you start the draw, entries close and a fingerprint of the full list (a Merkle root) is
          written to the blockchain. Changing a single name afterwards would change the fingerprint.
        </span>
      </li>
      <li>
        <span class="step-name">Chainlink picks a number</span>
        <span class="step-note">
          In the same transaction, the raffle asks Chainlink VRF for a random number. It arrives with a
          cryptographic proof that the chain checks before accepting it. Nobody, including us, can see
          the number in advance or ask for another one.
        </span>
      </li>
      <li>
        <span class="step-name">Anyone can redo the math</span>
        <span class="step-note">
          Winners follow from the number by a fixed public formula. Each raffle has a verify page that
          re-checks every step in your browser against the blockchain, without trusting this site.
        </span>
      </li>
    </ol>
  </section>
</div>

<style>
  .hero {
    display: grid;
    gap: var(--lh);
    justify-items: start;
    padding-top: calc(var(--lh) * 3);
  }
  .hat {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) 1.5ch;
    margin-bottom: var(--s-2);
  }
  h1 {
    font-size: var(--fs-2xl);
    line-height: calc(var(--lh) * 2);
    max-width: 24ch;
  }
  @media (max-width: 40rem) {
    h1 {
      font-size: var(--fs-xl);
      line-height: calc(var(--lh) * 1.5);
    }
  }
  .how li {
    padding-block: var(--s-3);
  }
  .how .step-note {
    margin-top: var(--s-1);
    font-family: var(--font-prose);
    font-size: var(--fs-base);
    line-height: 1.55;
    color: var(--ink-2);
  }
</style>
