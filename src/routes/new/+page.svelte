<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>New raffle | VRF Hat</title></svelte:head>

<div class="wrap narrow">
  <h1>New raffle</h1>
  <form method="POST">
    <div class="field">
      <label for="title">Name</label>
      <input id="title" name="title" type="text" required maxlength="120" value={form?.title ?? ""} placeholder="Office holiday gift draw" />
    </div>
    <div class="field">
      <label for="description">Details <span class="hint">optional</span></label>
      <textarea id="description" name="description" rows="3" maxlength="2000">{form?.description ?? ""}</textarea>
    </div>
    <div class="field">
      <label for="winnerCount">Number of winners</label>
      <input id="winnerCount" name="winnerCount" type="number" min="1" max="100" required value={form?.winnerCount ?? "1"} />
    </div>
    <div class="field check">
      <input id="selfEntry" name="selfEntry" type="checkbox" checked={form ? form.selfEntry : true} />
      <label for="selfEntry">
        Let people enter themselves
        <span class="hint">They sign in and add their own name. You can always add names yourself.</span>
      </label>
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button>Create raffle</button>
  </form>
</div>

<style>
  .narrow {
    max-width: 32rem;
    padding-top: 2rem;
  }
  .check {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .check input {
    margin-top: 0.35rem;
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--ink);
  }
  .check .hint {
    display: block;
  }
</style>
