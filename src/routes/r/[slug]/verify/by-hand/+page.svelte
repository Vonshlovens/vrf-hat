<script lang="ts">
  let { data } = $props();
  const raffle = $derived(data.raffle);
</script>

<svelte:head><title>By hand: {raffle.title} | VRF Hat</title></svelte:head>

<article class="page reading">
  <header class="page-head">
    <a class="crumb" href="/r/{raffle.slug}/verify">← Check this draw</a>
    <h1>Check it by hand</h1>
  </header>

  {#if raffle.status === "open"}
    <div class="state">
      <h3><span class="status" data-tone="idle">not drawn</span> Entries are still open</h3>
    </div>
  {:else}
    <ol class="prose diy">
      <li>
        Download <a href="/r/{raffle.slug}/entrants.json">the sealed entry list</a>. Each entry's leaf is
        <code>keccak256(keccak256(abi.encode(uint32 index, bytes16 ticket, string label)))</code>; pairs are
        hashed in sorted order, and an unpaired node moves up unchanged.
      </li>
      <li>
        On the contract <code>{raffle.contract}</code>, call <code>getDraw({raffle.raffleKey})</code> and
        compare <code>entrantsRoot</code> with your rebuilt root. The raffle key is
        <code>keccak256("vrf-hat:raffle:{raffle.raffleId}")</code>.
      </li>
      <li>
        Call <code>pickWinners(randomWord, entrantCount, winnerCount)</code> and look up those positions in
        the list. The source is in <code>contracts/RaffleDraw.sol</code>.
      </li>
    </ol>
  {/if}
</article>

<style>
  .diy {
    padding-left: 3ch;
  }
  .diy li + li {
    margin-top: var(--s-3);
  }
</style>
