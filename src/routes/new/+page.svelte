<script lang="ts">
  import { onMount } from "svelte";
  import CalendarEditor from "#lib/components/CalendarEditor.svelte";
  import { starterCalendar, type Calendar } from "#lib/draw/calendar.ts";

  let { data, form } = $props();

  // The form's own values after a rejected submit, otherwise the defaults.
  // svelte-ignore state_referenced_locally
  let mode = $state(form?.mode ?? "win");
  // svelte-ignore state_referenced_locally
  let cadence = $state(form?.cadence ?? "once");
  // svelte-ignore state_referenced_locally
  let firstDrawAt = $state(form?.firstDrawAt ?? "");
  // svelte-ignore state_referenced_locally
  let timezone = $state(form?.timezone ?? "");
  // svelte-ignore state_referenced_locally
  let winnerCount = $state(form?.winnerCount || "1");
  // svelte-ignore state_referenced_locally
  let keepCount = $state(form?.keepCount || "1");
  // svelte-ignore state_referenced_locally
  let returnPicked = $state(form?.returnPicked ?? false);
  // svelte-ignore state_referenced_locally
  let pickPlan = $state<"fixed" | "spread">(form?.pickPlan === "spread" ? "spread" : "fixed");
  // svelte-ignore state_referenced_locally
  let pickTotal = $state(form?.pickTotal || "");
  let calendar = $state<Calendar | null>(null);
  let earliest = $state("");

  const eliminate = $derived(mode === "eliminate");
  const recurring = $derived(cadence !== "once");

  const localValue = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  onMount(() => {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    earliest = localValue(new Date());
    if (!firstDrawAt) {
      // Tomorrow, on the hour.
      const d = new Date(Date.now() + 24 * 3_600_000);
      d.setMinutes(0, 0, 0);
      firstDrawAt = localValue(d);
    }
    let echoed: Calendar | null = null;
    try {
      echoed = form?.calendar ? JSON.parse(form.calendar) : null;
    } catch {
      // Start over with the default.
    }
    calendar = echoed ?? starterCalendar(earliest.slice(0, 10));
  });
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

    {#if data.orgs.length}
      <div class="field">
        <label for="audience">Who can see it</label>
        <select
          class="select"
          id="audience"
          name="audience"
          value={form?.audience ?? data.preselect}
          aria-describedby="audience-hint"
        >
          <option value="">Anyone with the link</option>
          {#each data.orgs as org (org.id)}
            <option value={org.id}>Members of {org.name}</option>
          {/each}
        </select>
        <p class="hint" id="audience-hint">
          Names, tickets and results. The on-chain record holds no names either way. Can't be changed later.
        </p>
      </div>
    {/if}

    <div class="field">
      <span class="field-label" id="mode-label">A name that's drawn</span>
      <fieldset class="segmented" aria-labelledby="mode-label">
        <label><input type="radio" name="mode" value="win" bind:group={mode} /><span>Wins</span></label>
        <label>
          <input type="radio" name="mode" value="eliminate" bind:group={mode} /><span>Is eliminated</span>
        </label>
      </fieldset>
      {#if eliminate}
        <p class="hint">Whoever is left in the hat at the end comes out on top.</p>
      {/if}
    </div>

    <div class="field">
      <span class="field-label" id="cadence-label">Draw</span>
      <fieldset class="segmented" aria-labelledby="cadence-label">
        <label><input type="radio" name="cadence" value="once" bind:group={cadence} /><span>Once</span></label>
        <label>
          <input type="radio" name="cadence" value="calendar" bind:group={cadence} /><span>On set dates</span>
        </label>
        <label>
          <input type="radio" name="cadence" value="scheduled" bind:group={cadence} /><span>At an interval</span>
        </label>
        <label>
          <input type="radio" name="cadence" value="manual" bind:group={cadence} /><span>Whenever I say</span>
        </label>
      </fieldset>
      {#if cadence === "manual"}
        <p class="hint">Round after round, each started by you.</p>
      {:else if cadence === "calendar"}
        <p class="hint">Pick weekdays and dates on a calendar.</p>
      {:else if cadence === "scheduled"}
        <p class="hint">Every so many hours, days or weeks.</p>
      {/if}
    </div>

    {#if cadence !== "calendar"}
      <div class="field">
        <label for="winnerCount">{eliminate ? "Eliminated" : "Winners"} per draw</label>
        <input
          class="input num count"
          id="winnerCount"
          name="winnerCount"
          type="number"
          min="1"
          max="100"
          required
          bind:value={winnerCount}
        />
      </div>
    {/if}

    {#if cadence === "scheduled"}
      <div class="field">
        <label for="firstDrawAt">First draw</label>
        <input
          class="input when"
          id="firstDrawAt"
          name="firstDrawAt"
          type="datetime-local"
          required
          min={earliest}
          bind:value={firstDrawAt}
          aria-describedby="tz-hint"
        />
        <p class="hint" id="tz-hint">{timezone ? `${timezone} time.` : "Your local time."}</p>
      </div>
      <div class="field">
        <label for="repeatEvery">Then every</label>
        <div class="every">
          <input
            class="input num count"
            id="repeatEvery"
            name="repeatEvery"
            type="number"
            min="1"
            max="365"
            required
            value={form?.repeatEvery || "1"}
          />
          <select class="select unit" name="repeatUnit" aria-label="Unit" value={form?.repeatUnit || "week"}>
            <option value="hour">hours</option>
            <option value="day">days</option>
            <option value="week">weeks</option>
          </select>
        </div>
      </div>
    {/if}
    <input type="hidden" name="timezone" value={timezone} />

    {#if recurring}
      {#if eliminate}
        <div class="field">
          <label for="keepCount">Stop when this many names are left</label>
          <input
            class="input num count"
            id="keepCount"
            name="keepCount"
            type="number"
            min="1"
            max="1000"
            required
            bind:value={keepCount}
          />
        </div>
      {:else}
        <label class="check">
          <input name="returnPicked" type="checkbox" bind:checked={returnPicked} />
          <span>
            Winners go back in the hat
            <span class="hint">Otherwise a winning ticket sits out the later draws.</span>
          </span>
        </label>
      {/if}
      {#if cadence !== "calendar"}
        <div class="field">
          <label for="maxDraws">Stop after this many draws <span class="optional">optional</span></label>
          <input
            class="input num count"
            id="maxDraws"
            name="maxDraws"
            type="number"
            min="1"
            max="1000"
            value={form?.maxDraws ?? ""}
            aria-describedby="max-hint"
          />
          <p class="hint" id="max-hint">
            {eliminate ? "Blank: keep going until that many names are left." : "Blank: keep going until the hat is empty or you end it."}
          </p>
        </div>
      {/if}
    {/if}

    {#if cadence === "calendar"}
      {#if calendar && timezone}
        <CalendarEditor
          bind:calendar
          bind:pickPlan
          bind:pickTotal
          bind:winnerCount
          {timezone}
          mode={eliminate ? "eliminate" : "win"}
          keepCount={Math.max(1, Number(keepCount) || 1)}
          {returnPicked}
          id="new-cal"
        />
      {:else}
        <p class="hint">Loading the calendar…</p>
      {/if}
    {/if}

    <label class="check">
      <input name="selfEntry" type="checkbox" checked={form ? form.selfEntry : true} />
      <span>
        People can add their own name
        <span class="hint">One ticket each. You can give any name more.</span>
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
  .when {
    max-width: 28ch;
  }
  .every {
    display: flex;
    gap: 1ch;
  }
  .unit {
    width: auto;
  }
  .segmented {
    justify-self: start;
    flex-wrap: wrap;
    max-width: 100%;
  }
</style>
