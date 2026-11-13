<script lang="ts">
  import "#lib/styles.css";
  import { page } from "$app/state";
  import ThemeToggle from "#lib/components/ThemeToggle.svelte";
  let { data, children } = $props();
</script>

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell">
  <header class="masthead">
    <a class="wordmark" href="/">VRF Hat</a>
    <nav aria-label="Main">
      {#if data.user}
        <a href="/new" aria-current={page.url.pathname === "/new" ? "page" : undefined}>New raffle</a>
        <form method="POST" action="/logout">
          <button class="btn ghost small" type="submit">Sign out</button>
        </form>
      {:else}
        <a href="/login" aria-current={page.url.pathname === "/login" ? "page" : undefined}>Sign in</a>
      {/if}
    </nav>
  </header>
</div>

<main id="main">
  {@render children()}
</main>

<div class="shell">
  <footer class="foot">
    <a class="small" href="/how" aria-current={page.url.pathname === "/how" ? "page" : undefined}>How it works</a>
    <ThemeToggle />
  </footer>
</div>

<style>
  .shell {
    max-width: 84rem;
    margin-inline: auto;
    padding-inline: var(--gutter);
  }
  nav {
    align-items: center;
  }
  nav form {
    display: contents;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--gutter);
    padding: var(--s-3) 0 var(--lh);
    border-top: var(--double-w) double var(--rule);
  }
</style>
