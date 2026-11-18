<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head>
  <title>Invitation | VRF Hat</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page narrow">
  {#if data.invitation}
    <header class="page-head">
      <h1>Join {data.invitation.orgName}</h1>
      <p class="lede">
        {data.invitation.inviter} invited you as {data.invitation.role === "admin" ? "an admin" : "a member"}.
        Members can see and enter the organization's raffles.
      </p>
    </header>
    <form method="POST" class="btn-row">
      <button class="btn primary" formaction="?/accept">Accept</button>
      <button class="btn ghost" formaction="?/decline">Decline</button>
    </form>
  {:else}
    <header class="page-head">
      <h1>Invitation</h1>
    </header>
    <p class="notice" data-tone="fail" role="alert">{data.problem}</p>
    <p class="meta">
      You're signed in as {data.signedInAs}. An invitation only works for the address it was sent to, and expires
      after 7 days. If it went to another address, sign out and sign in with that one.
    </p>
  {/if}
  {#if form?.error}<p class="notice" data-tone="fail" role="alert">{form.error}</p>{/if}
</div>
