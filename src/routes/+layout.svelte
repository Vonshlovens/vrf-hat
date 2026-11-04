<script lang="ts">
  import "#lib/styles.css";
  let { data, children } = $props();
</script>

<header class="wrap top">
  <a class="brand" href="/">
    <svg viewBox="0 0 32 20" width="32" height="20" aria-hidden="true">
      <rect x="0" y="0" width="32" height="20" rx="2" fill="var(--ticket)" />
      <circle cx="22" cy="0" r="2.6" fill="var(--paper)" />
      <circle cx="22" cy="20" r="2.6" fill="var(--paper)" />
      <line x1="22" y1="4" x2="22" y2="16" stroke="var(--ticket-ink)" stroke-width="1" stroke-dasharray="1.5 1.5" />
    </svg>
    VRF Hat
  </a>
  <nav>
    {#if data.user}
      <a href="/new">New raffle</a>
      <form method="POST" action="/logout">
        <button class="quiet" type="submit">Sign out</button>
      </form>
    {:else}
      <a href="/login">Sign in</a>
    {/if}
  </nav>
</header>

<main>
  {@render children()}
</main>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1.25rem;
    padding-bottom: 1.25rem;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 700;
    font-size: var(--t-md);
    color: var(--ink);
    text-decoration: none;
    letter-spacing: -0.02em;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  nav form {
    margin: 0;
  }
  main {
    padding-bottom: 5rem;
  }
</style>
