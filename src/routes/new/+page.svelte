<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>New raffle | VRF Hat</title></svelte:head>

<div class="page narrow">
  <header class="page-head">
    <h1>New raffle</h1>
  </header>
  <form method="POST" class="form">
    <div class="field">
      <label for="title">Name</label>
      <input
        class="input"
        id="title"
        name="title"
        type="text"
        required
        maxlength="120"
        value={form?.title ?? ""}
        placeholder="Office holiday gift draw"
      />
    </div>
    <div class="field">
      <label for="description">Details <span class="optional">optional</span></label>
      <textarea class="textarea" id="description" name="description" rows="3" maxlength="2000"
        >{form?.description ?? ""}</textarea
      >
    </div>
    <div class="field">
      <label for="winnerCount">Number of winners</label>
      <input
        class="input num count"
        id="winnerCount"
        name="winnerCount"
        type="number"
        min="1"
        max="100"
        required
        value={form?.winnerCount ?? "1"}
      />
    </div>
    <label class="check">
      <input name="selfEntry" type="checkbox" checked={form ? form.selfEntry : true} />
      <span>
        Let people enter themselves
        <span class="hint">They sign in and add their own name. You can always add names yourself.</span>
      </span>
    </label>
    {#if form?.error}<p class="field-error" role="alert">{form.error}</p>{/if}
    <div class="btn-row">
      <button class="btn primary">Create raffle</button>
    </div>
  </form>
</div>

<style>
  .count {
    max-width: 12ch;
  }
</style>
