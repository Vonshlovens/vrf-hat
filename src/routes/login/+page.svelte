<script lang="ts">
  import { enhance } from "$app/forms";
  let { data, form } = $props();
  let sending = $state(false);

  const names = { github: "GitHub", google: "Google", discord: "Discord" } as const;
</script>

<svelte:head><title>Sign in | VRF Hat</title></svelte:head>

<div class="wrap narrow">
  <h1>Sign in</h1>
  <p class="muted">You need an account to run a raffle or put your own name in one.</p>

  {#if form?.sent}
    <div class="sent" role="status">
      <h2>Check your email</h2>
      <p>We sent a sign-in link to <strong>{form.sent}</strong>. It works once and expires in 5 minutes.</p>
    </div>
  {:else}
    {#if data.providers.length}
      <form method="POST" action="?/social" class="providers">
        <input type="hidden" name="next" value={data.next} />
        {#each data.providers as provider (provider)}
          <button class="secondary" name="provider" value={provider}>Continue with {names[provider]}</button>
        {/each}
      </form>
      <p class="or muted">or get a link by email</p>
    {/if}

    <form
      method="POST"
      action="?/magic"
      use:enhance={() => {
        sending = true;
        return async ({ update }) => {
          await update();
          sending = false;
        };
      }}
    >
      <input type="hidden" name="next" value={data.next} />
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required value={form?.email ?? ""} />
      </div>
      {#if form?.error}<p class="error">{form.error}</p>{/if}
      <button disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  {/if}
</div>

<style>
  .narrow {
    max-width: 28rem;
    padding-top: 2rem;
  }
  .providers {
    display: grid;
    gap: 0.6rem;
    margin: 2rem 0 0;
  }
  .providers button {
    justify-content: center;
  }
  .or {
    margin: 1.5rem 0 1rem;
  }
  .sent {
    margin-top: 2rem;
    padding: 1.25rem 1.5rem;
    border-left: 4px solid var(--ticket);
    background: var(--surface);
  }
</style>
