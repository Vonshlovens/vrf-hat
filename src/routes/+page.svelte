<script lang="ts">
  let { data } = $props();

  const statusWord = { open: "open", requested: "drawing", drawn: "drawn" } as const;
  const statusTone = { open: "idle", requested: "run", drawn: "ok" } as const;
</script>

<svelte:head><title>VRF Hat</title></svelte:head>

<div class="page">
  {#if data.user && data.hosted.length}
    <header class="page-head head">
      <h1>Your raffles</h1>
      <a class="btn primary" href="/new">New raffle</a>
    </header>
    <table class="table rows">
      <tbody>
        {#each data.hosted as { raffle, entrants } (raffle.id)}
          <tr>
            <th scope="row"><a class="row-link" href="/r/{raffle.slug}">{raffle.title}</a></th>
            <td class="num w-min">{entrants}</td>
            <td class="w-min">
              <span class="status" data-tone={statusTone[raffle.status]}>
                {#if raffle.status === "requested"}<span class="live" aria-hidden="true"></span>{/if}{statusWord[raffle.status]}
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <section class="hero">
      <h1>A hat anyone can check.</h1>
      <div class="btn-row">
        <a class="btn primary" href={data.user ? "/new" : "/login?next=/new"}>Start a raffle</a>
        <a href="/how">How it works</a>
      </div>
    </section>
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--gutter);
  }
  .hero {
    display: grid;
    gap: var(--lh);
    justify-items: start;
    padding-top: calc(var(--lh) * 4);
  }
  .hero h1 {
    font-size: var(--fs-2xl);
    line-height: calc(var(--lh) * 2);
  }
</style>
