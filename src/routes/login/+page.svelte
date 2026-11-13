<script lang="ts">
  import { enhance } from "$app/forms";
  let { data, form } = $props();
  let sending = $state(false);

  const names = { github: "GitHub", google: "Google", discord: "Discord" } as const;
  // Errors from the email form carry the email back; provider errors don't.
  const emailError = $derived(form?.error && "email" in form ? form.error : null);
  const otherError = $derived(form?.error && !emailError ? form.error : null);
</script>

<svelte:head><title>Sign in | VRF Hat</title></svelte:head>

<div class="page narrow">
  <header class="page-head">
    <h1>Sign in</h1>
  </header>

  {#if form?.sent}
    <div class="state" role="status">
      <h3><span class="status" data-tone="ok">sent</span> Check your email</h3>
      <p>Link sent to <strong>{form.sent}</strong>. It works once, for 5 minutes.</p>
    </div>
  {:else}
    {#if otherError}<p class="notice" data-tone="fail" role="alert">{otherError}</p>{/if}
    {#if data.providers.length}
      <form method="POST" action="?/social" class="providers">
        <input type="hidden" name="next" value={data.next} />
        {#each data.providers as provider (provider)}
          <button class="btn" name="provider" value={provider}>Continue with {names[provider]}</button>
        {/each}
      </form>
      <p class="or meta small">or get a link by email</p>
    {/if}

    <form
      method="POST"
      action="?/magic"
      class="form"
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
        <input
          class="input"
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          value={form?.email ?? ""}
          aria-invalid={emailError ? "true" : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
        />
        {#if emailError}<p class="field-error" id="email-error">{emailError}</p>{/if}
      </div>
      <div class="btn-row">
        <button class="btn primary" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .notice {
    margin-bottom: var(--lh);
  }
  .providers {
    display: grid;
    gap: var(--s-2);
  }
  .or {
    display: flex;
    align-items: center;
    gap: 1ch;
    margin: var(--lh) 0;
  }
  .or::before,
  .or::after {
    content: "";
    flex: 1;
    border-top: var(--hair-w) solid var(--line);
  }
</style>
