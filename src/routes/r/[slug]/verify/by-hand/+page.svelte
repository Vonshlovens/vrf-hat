<script lang="ts">
  let { data } = $props();
  const raffle = $derived(data.raffle);
  const draw = $derived(data.draw);
  const eliminate = $derived(raffle.mode === "eliminate");
</script>

<svelte:head><title>By hand: {raffle.title} | VRF Hat</title></svelte:head>

<article class="page reading">
  <header class="page-head">
    <a class="crumb" href="/r/{raffle.slug}/verify{draw ? `?round=${draw.round}` : ''}">
      ← Check {raffle.recurring && draw ? `round ${draw.round}` : "this draw"}
    </a>
    <h1>Check it by hand</h1>
  </header>

  {#if !draw}
    <div class="state">
      <h3><span class="status" data-tone="idle">not drawn</span> Nothing has been drawn yet</h3>
    </div>
  {:else}
    <ol class="prose diy">
      <li>
        Download <a href="/r/{raffle.slug}/entrants.json?round={draw.round}">the sealed list</a>. It has one
        line per ticket, so a name holding three tickets appears three times. Each ticket's leaf is
        <code>keccak256(keccak256(abi.encode(uint32 index, bytes16 ticket, string label)))</code>; pairs are
        hashed in sorted order, and an unpaired node moves up unchanged.
      </li>
      <li>
        On the contract <code>{draw.contract}</code>, call <code>getDraw({draw.raffleKey})</code> and
        compare <code>entrantsRoot</code> with your rebuilt root. The key is
        <code>keccak256("{draw.keyText}")</code>{#if draw.keyText.includes(":" + raffle.mode + ":")}, which
          names the round and what being drawn means{/if}.
      </li>
      <li>
        Call <code>pickWinners(randomWord, entrantCount, winnerCount)</code> and look up those positions in
        the list.
        {#if eliminate}Here the positions it returns are the tickets eliminated, not winners.{/if}
        The source is in <code>contracts/RaffleDraw.sol</code>.
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
