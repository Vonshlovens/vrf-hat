<script lang="ts">
  import { page } from "$app/state";

  // The emailed link lands here, and only the button below spends the
  // one-time token, so a mail scanner opening the link can't use it up.
  const params = $derived([...page.url.searchParams.entries()]);
  const hasToken = $derived(page.url.searchParams.has("token"));
</script>

<svelte:head>
  <title>Sign in | VRF Hat</title>
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="page narrow">
  <header class="page-head">
    <h1>Sign in</h1>
  </header>
  {#if hasToken}
    <div class="flow">
      <form method="GET" action="/api/auth/magic-link/verify" data-sveltekit-reload>
        {#each params as [name, value] (name)}
          <input type="hidden" {name} {value} />
        {/each}
        <button class="btn primary">Sign in</button>
      </form>
      <p class="hint">Didn't ask to sign in? Close this page.</p>
    </div>
  {:else}
    <div class="state" data-tone="fail" role="alert">
      <h3>This sign-in link is incomplete</h3>
      <div class="btn-row"><a class="btn" href="/login">Get a new link</a></div>
    </div>
  {/if}
</div>
