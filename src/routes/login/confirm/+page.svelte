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

<div class="wrap narrow">
  <h1>Sign in</h1>
  {#if hasToken}
    <p>Finish signing in to VRF Hat on this device.</p>
    <form method="GET" action="/api/auth/magic-link/verify" data-sveltekit-reload>
      {#each params as [name, value] (name)}
        <input type="hidden" {name} {value} />
      {/each}
      <button>Sign in</button>
    </form>
    <p class="muted small">If you didn't ask to sign in, close this page. Nothing happens until you press the button.</p>
  {:else}
    <p class="error">This sign-in link is incomplete. Copy the whole link from the email, or request a new one.</p>
    <a class="button" href="/login">Get a new link</a>
  {/if}
</div>

<style>
  .narrow {
    max-width: 28rem;
    padding-top: 2rem;
  }
  form {
    margin: 1.5rem 0;
  }
  .small {
    font-size: var(--t-sm);
  }
</style>
