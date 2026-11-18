<!--
  Builds a calendar schedule: weekly rules, one-off dates and skipped days,
  an end, and how many each draw pulls. Shows the planned draws with their
  counts before anything is saved. Posts `calendar` (JSON), `pickPlan`,
  `pickTotal` and `winnerCount`.
-->
<script lang="ts">
  import { tick } from "svelte";
  import {
    MAX_RULES,
    MAX_WEEKS_APART,
    WEEKDAY_NAMES,
    dayNumber,
    dayString,
    isBounded,
    occurrences,
    ordinal,
    weekdayOf,
    type Calendar,
    type CalendarEnd,
  } from "#lib/draw/calendar.ts";
  import { formatDay, formatTime, planRows } from "#lib/draw/plan.ts";
  import type { Hat } from "#lib/draw/rounds.ts";
  import { toLocalDateTime } from "#lib/draw/schedule.ts";

  type Props = {
    calendar: Calendar;
    pickPlan: "fixed" | "spread";
    pickTotal: string;
    winnerCount: string;
    timezone: string;
    mode: "win" | "eliminate";
    keepCount: number;
    returnPicked: boolean;
    /** What's in the hat now; null before the raffle exists (the preview asks for a guess). */
    hat?: Hat | null;
    /** Tickets pulled so far. */
    pulled?: number;
    /** Prefix for element ids, so two editors can share a page. */
    id?: string;
  };

  let {
    calendar = $bindable(),
    pickPlan = $bindable(),
    pickTotal = $bindable(),
    winnerCount = $bindable(),
    timezone,
    mode,
    keepCount,
    returnPicked,
    hat = null,
    pulled = 0,
    id = "cal",
  }: Props = $props();

  const eliminate = $derived(mode === "eliminate");
  const tz = $derived(timezone || "UTC");
  const now = new Date();
  const today = $derived(toLocalDateTime(now, tz).slice(0, 10));
  const defaultTime = $derived(calendar.rules[0]?.time ?? calendar.dates[0]?.time ?? "19:00");

  // Before there's a raffle, preview with a guessed number of names.
  let guess = $state(20);
  const previewHat = $derived(hat ?? { tickets: guess, names: guess });

  const occ = $derived(occurrences(calendar));
  const bounded = $derived(isBounded(calendar));
  const spread = $derived(pickPlan === "spread" && bounded);

  const rows = $derived.by(() => {
    const per = Number(winnerCount);
    const total = Number(pickTotal);
    return planRows(
      {
        mode,
        winnerCount: per >= 1 ? per : 1,
        recurring: true,
        keepCount,
        returnPicked,
        maxDraws: null,
        pickPlan: spread ? "spread" : "fixed",
        pickTotal: total >= 1 ? total : 0,
      },
      calendar,
      tz,
      previewHat,
      pulled,
      now,
    );
  });
  const SHOWN = 24;
  const lastRow = $derived(rows.at(-1));

  // Which days carry what, for the grid.
  const byDay = $derived.by(() => {
    const map = new Map<string, { times: string[]; rule: boolean; date: boolean }>();
    for (const o of occ.planned) {
      const d = map.get(o.date) ?? { times: [], rule: false, date: false };
      d.times.push(o.time);
      if (o.source === "rule") d.rule = true;
      else d.date = true;
      map.set(o.date, d);
    }
    return map;
  });
  const skipped = $derived(new Set(occ.skipped));

  // ----------------------------------------------------------- the grid
  // svelte-ignore state_referenced_locally
  const startDay = toLocalDateTime(now, tz).slice(0, 10);
  // Open on the month of the next planned draw.
  // svelte-ignore state_referenced_locally
  let view = $state((occ.planned.find((o) => o.date >= startDay)?.date ?? startDay).slice(0, 7));
  let focused = $state("");

  const MONTHS = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const LONG = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthStart = $derived(dayNumber(`${view}-01`));
  const weeks = $derived.by(() => {
    // Weeks start on Monday.
    const lead = (weekdayOf(monthStart) + 6) % 7;
    const first = monthStart - lead;
    const out: { day: number; date: string; inMonth: boolean }[][] = [];
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const day = first + w * 7 + i;
        const date = dayString(day);
        week.push({ day, date, inMonth: date.startsWith(view) });
      }
      if (w > 3 && !week.some((d) => d.inMonth)) break;
      out.push(week);
    }
    return out;
  });
  const tabStop = $derived(
    focused.startsWith(view) ? focused : today.startsWith(view) ? today : `${view}-01`,
  );

  function shiftMonth(by: number) {
    const [y, m] = view.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    view = d.toISOString().slice(0, 7);
  }

  function toggle(date: string) {
    if (date < today) return;
    focused = date;
    const info = byDay.get(date);
    if (skipped.has(date)) {
      calendar.skips = calendar.skips.filter((s) => s !== date);
    } else if (info?.rule) {
      calendar.skips = [...calendar.skips, date].sort();
    } else if (info?.date) {
      calendar.dates = calendar.dates.filter((d) => d.date !== date);
    } else {
      calendar.dates = [...calendar.dates, { date, time: defaultTime }].sort((a, b) =>
        `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
      );
    }
  }

  let grid: HTMLElement | undefined = $state();
  async function onKey(e: KeyboardEvent, day: number) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    let target: number | undefined = step === undefined ? undefined : day + step;
    if (e.key === "Home") target = day - ((weekdayOf(day) + 6) % 7);
    if (e.key === "End") target = day + (6 - ((weekdayOf(day) + 6) % 7));
    if (e.key === "PageUp" || e.key === "PageDown") {
      shiftMonth(e.key === "PageUp" ? -1 : 1);
      target = dayNumber(`${view}-01`);
    }
    if (target === undefined) return;
    e.preventDefault();
    focused = dayString(target);
    if (!focused.startsWith(view)) view = focused.slice(0, 7);
    await tick();
    grid?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }

  function dayLabel(date: string) {
    const name = LONG.format(new Date(dayNumber(date) * 86_400_000));
    const info = byDay.get(date);
    if (skipped.has(date)) return `${name}, skipped`;
    if (info) return `${name}, draw at ${info.times.join(" and ")}`;
    return `${name}, no draw`;
  }

  // ----------------------------------------------------------- rules
  function addRule() {
    const start = today;
    calendar.rules = [
      ...calendar.rules,
      { weekday: weekdayOf(dayNumber(start)), every: 1, start, time: defaultTime },
    ];
  }

  // ----------------------------------------------------------- end
  let endDate = $state(calendar.end.kind === "date" ? calendar.end.date : "");
  let endCount = $state(calendar.end.kind === "count" ? String(calendar.end.count) : "8");
  // svelte-ignore state_referenced_locally
  let endKind = $state<CalendarEnd["kind"]>(calendar.end.kind);
  $effect(() => {
    if (endKind === "date") {
      if (!endDate) endDate = dayString(dayNumber(today) + 8 * 7);
      calendar.end = { kind: "date", date: endDate };
    } else if (endKind === "count") {
      const n = Math.max(1, Math.min(1000, Math.floor(Number(endCount)) || 1));
      calendar.end = { kind: "count", count: n };
    } else {
      calendar.end = { kind: "none" };
    }
  });

  $effect(() => {
    if (!bounded && pickPlan === "spread") pickPlan = "fixed";
  });

  const serialized = $derived(JSON.stringify(calendar));
  const noDates = $derived(occ.planned.length === 0);
</script>

<div class="cal-editor">
  <fieldset class="field">
    <legend>Weekly draws</legend>
    {#if calendar.rules.length === 0}
      <p class="hint">None yet. Add one, or pick single dates on the calendar.</p>
    {/if}
    <ul class="rules">
      {#each calendar.rules as rule, i (i)}
        <li class="rule">
          <span class="rule-part">
            <label class="sr-only" for="{id}-every-{i}">Repeat</label>
            <select class="select" id="{id}-every-{i}" bind:value={rule.every}>
              {#each Array.from({ length: MAX_WEEKS_APART }, (_, n) => n + 1) as n (n)}
                <option value={n}>{n === 1 ? "Every" : `Every ${ordinal(n)}`}</option>
              {/each}
            </select>
            <label class="sr-only" for="{id}-day-{i}">Day</label>
            <select class="select" id="{id}-day-{i}" bind:value={rule.weekday}>
              {#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
                <option value={d}>{WEEKDAY_NAMES[d]}</option>
              {/each}
            </select>
          </span>
          <span class="rule-part">
            <label for="{id}-time-{i}">at</label>
            <input class="input time" id="{id}-time-{i}" type="time" required bind:value={rule.time} />
            <label for="{id}-start-{i}">from</label>
            <input class="input date" id="{id}-start-{i}" type="date" required bind:value={rule.start} />
          </span>
          <button
            type="button"
            class="btn ghost small"
            aria-label="Remove {rule.every === 1 ? 'every' : `every ${ordinal(rule.every)}`} {WEEKDAY_NAMES[rule.weekday]}"
            onclick={() => (calendar.rules = calendar.rules.filter((_, j) => j !== i))}>Remove</button
          >
        </li>
      {/each}
    </ul>
    {#if calendar.rules.length < MAX_RULES}
      <div class="btn-row">
        <button type="button" class="btn small" onclick={addRule}>Add a weekly draw</button>
      </div>
    {/if}
  </fieldset>

  <div class="field">
    <span class="field-label" id="{id}-grid-label">Calendar</span>
    <div class="month" bind:this={grid}>
      <div class="month-head">
        <button type="button" class="btn ghost small" onclick={() => shiftMonth(-1)} aria-label="Previous month"
          >‹</button
        >
        <span class="month-name" aria-live="polite">{MONTHS.format(new Date(monthStart * 86_400_000))}</span>
        <button type="button" class="btn ghost small" onclick={() => shiftMonth(1)} aria-label="Next month">›</button>
      </div>
      <table class="days" aria-labelledby="{id}-grid-label">
        <thead>
          <tr>{#each HEADS as h (h)}<th scope="col" abbr={h}>{h.slice(0, 2)}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each weeks as week (week[0].date)}
            <tr>
              {#each week as d (d.date)}
                {@const info = byDay.get(d.date)}
                <td>
                  <button
                    type="button"
                    class="day"
                    class:out-month={!d.inMonth}
                    class:today={d.date === today}
                    data-date={d.date}
                    data-state={skipped.has(d.date) ? "skipped" : info ? (info.rule ? "rule" : "date") : "none"}
                    aria-pressed={Boolean(info)}
                    aria-label={dayLabel(d.date)}
                    disabled={d.date < today}
                    tabindex={d.date === tabStop ? 0 : -1}
                    onclick={() => toggle(d.date)}
                    onkeydown={(e) => onKey(e, d.day)}
                  >
                    {Number(d.date.slice(8))}
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="legend hint">
        <span><i class="swatch" data-state="rule"></i>weekly</span>
        <span><i class="swatch" data-state="date"></i>single date</span>
        <span><i class="swatch" data-state="skipped"></i>skipped</span>
      </p>
    </div>
    <p class="hint">Tap a free day to add a single draw; tap a weekly day to skip it. {tz} time.</p>
  </div>

  {#if calendar.dates.length}
    <fieldset class="field">
      <legend>Single dates</legend>
      <ul class="singles">
        {#each calendar.dates as d, i (`${d.date}-${i}`)}
          <li>
            <label for="{id}-one-{i}">{formatDay(new Date(dayNumber(d.date) * 86_400_000), "UTC", now)}</label>
            <input class="input time" id="{id}-one-{i}" type="time" required bind:value={d.time} />
            <button
              type="button"
              class="btn ghost small"
              aria-label="Remove the draw on {d.date}"
              onclick={() => (calendar.dates = calendar.dates.filter((_, j) => j !== i))}>Remove</button
            >
          </li>
        {/each}
      </ul>
    </fieldset>
  {/if}

  {#if occ.skipped.length}
    <p class="hint skips">
      Skipped:
      {#each occ.skipped as s (s)}
        <button
          type="button"
          class="btn ghost small"
          aria-label="Put back the draw on {s}"
          onclick={() => (calendar.skips = calendar.skips.filter((x) => x !== s))}
          >{formatDay(new Date(dayNumber(s) * 86_400_000), "UTC", now)} ×</button
        >
      {/each}
    </p>
  {/if}

  {#if calendar.rules.length}
    <div class="field">
      <span class="field-label" id="{id}-end-label">Weekly draws end</span>
      <fieldset class="segmented" aria-labelledby="{id}-end-label">
        <label><input type="radio" value="date" bind:group={endKind} /><span>On a date</span></label>
        <label><input type="radio" value="count" bind:group={endKind} /><span>After a number of draws</span></label>
        <label>
          <input type="radio" value="none" bind:group={endKind} /><span
            >{eliminate ? `When ${keepCount} ${keepCount === 1 ? "ticket is" : "tickets are"} left` : "When the hat is empty"}</span
          >
        </label>
      </fieldset>
      {#if endKind === "date"}
        <label class="sr-only" for="{id}-end-date">Last day</label>
        <input class="input date" id="{id}-end-date" type="date" min={today} required bind:value={endDate} />
      {:else if endKind === "count"}
        <span class="inline-num">
          <input
            class="input num count"
            id="{id}-end-count"
            type="number"
            min="1"
            max="1000"
            required
            bind:value={endCount}
            aria-label="Number of weekly draws"
          />
          <span class="hint">weekly draws, counting from the first</span>
        </span>
      {/if}
    </div>
  {/if}

  <div class="field">
    <span class="field-label" id="{id}-picks-label">{eliminate ? "Eliminated" : "Winners"} at each draw</span>
    <fieldset class="segmented" aria-labelledby="{id}-picks-label">
      <label><input type="radio" value="fixed" bind:group={pickPlan} /><span>The same number</span></label>
      <label>
        <input type="radio" value="spread" bind:group={pickPlan} disabled={!bounded} /><span>Work it out for me</span>
      </label>
    </fieldset>
    {#if !spread}
      <span class="inline-num">
        <input
          class="input num count"
          name="winnerCount"
          type="number"
          min="1"
          max="100"
          required
          bind:value={winnerCount}
          aria-labelledby="{id}-picks-label"
        />
        <span class="hint">per draw</span>
      </span>
      {#if !bounded}
        <p class="hint">To have it worked out, give the weekly draws an end.</p>
      {/if}
    {:else}
      <input type="hidden" name="winnerCount" value={winnerCount || "1"} />
      {#if eliminate}
        <p class="hint">
          Shared out over the draws so {keepCount} {keepCount === 1 ? "is" : "are"} left after the last one. Earlier draws
          take any extra. Re-worked at every draw, so late entries still count.
        </p>
      {:else}
        <span class="inline-num">
          <input
            class="input num count"
            id="{id}-total"
            name="pickTotal"
            type="number"
            min="1"
            max="10000"
            required
            bind:value={pickTotal}
            aria-label="Winners in all"
          />
          <span class="hint">winners in all, shared out over the draws</span>
        </span>
      {/if}
    {/if}
  </div>

  <div class="field">
    <span class="field-label" id="{id}-plan-label">The plan</span>
    {#if !hat}
      <span class="inline-num">
        <span class="hint">If</span>
        <input
          class="input num count"
          type="number"
          min="1"
          max="10000"
          bind:value={guess}
          aria-label="Names to plan for"
        />
        <span class="hint">names enter</span>
      </span>
    {/if}
    {#if noDates}
      <p class="field-error">No draw dates yet.</p>
    {:else if rows.length === 0}
      <p class="field-error">Every date on the calendar has passed.</p>
    {:else}
      <ol class="plan" aria-labelledby="{id}-plan-label">
        {#each rows.slice(0, SHOWN) as row, i (row.at.getTime())}
          <li data-state={row.picks === 0 ? "done" : undefined}>
            <span class="plan-day">{formatDay(row.at, tz, now)}</span>
            <span class="plan-text">
              {formatTime(row.at, tz)} · {#if row.picks === 0}<span class="status" data-tone="idle">skipped</span
                >{:else}{row.text}{/if}
              {#if i === rows.length - 1 && eliminate && spread}<small>last draw</small>{/if}
            </span>
          </li>
        {/each}
      </ol>
      {#if rows.length > SHOWN}
        <p class="hint">
          …and {rows.length - SHOWN} more{lastRow && bounded ? `, the last on ${formatDay(lastRow.at, tz, now)}` : ""}.
        </p>
      {/if}
      {#if eliminate && lastRow && lastRow.ticketsLeft > keepCount}
        <p class="hint">
          At this pace {lastRow.ticketsLeft} tickets would still be in after the last date. {spread
            ? ""
            : "Choose “work it out for me” to land on the target."}
        </p>
      {/if}
      {#if !bounded}
        <p class="hint">Repeats until {eliminate ? `${keepCount} left` : "the hat is empty"}.</p>
      {/if}
    {/if}
  </div>

  <input type="hidden" name="calendar" value={serialized} />
  <input type="hidden" name="pickPlan" value={spread ? "spread" : "fixed"} />
</div>

<style>
  .cal-editor {
    display: grid;
    gap: var(--lh);
    min-width: 0;
  }
  fieldset.field {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .rules,
  .singles {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--s-2);
  }
  .rule {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) 1ch;
    padding-bottom: var(--s-2);
    border-bottom: var(--hair-w) solid var(--line);
  }
  .rule-part {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) 1ch;
  }
  .rule .select {
    width: auto;
  }
  .time {
    width: 16ch;
  }
  .date {
    width: auto;
    max-width: 20ch;
  }
  .count {
    max-width: 12ch;
  }
  .inline-num {
    display: flex;
    align-items: center;
    gap: 1ch;
  }
  .inline-num .hint {
    margin: 0;
  }
  .segmented {
    justify-self: start;
    flex-wrap: wrap;
    max-width: 100%;
  }
  .singles li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ch;
  }
  .singles label {
    min-width: 11ch;
  }
  .skips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) 0.5ch;
  }

  .month {
    max-width: 24rem;
    border: var(--rule-w) solid var(--ink);
    padding: var(--s-2);
  }
  .month-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1ch;
    margin-bottom: var(--s-2);
  }
  .month-name {
    font-weight: var(--fw-bold);
  }
  .days {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }
  .days th {
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    color: var(--ink-3);
    text-align: center;
    padding-bottom: var(--s-1);
  }
  .days td {
    padding: 1px;
    text-align: center;
  }
  .day {
    width: 100%;
    aspect-ratio: 1;
    min-height: 2.25rem;
    display: grid;
    place-items: center;
    border: var(--hair-w) solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .day:hover:not(:disabled) {
    background: var(--paper-sunk);
  }
  .day:focus-visible {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: 1px;
  }
  .day.out-month {
    color: var(--ink-3);
  }
  .day.today {
    border-color: var(--ink-3);
  }
  .day:disabled {
    color: var(--line-strong);
    cursor: default;
  }
  .day[data-state="rule"],
  .swatch[data-state="rule"] {
    background: var(--ticket);
    color: var(--ticket-ink);
    font-weight: var(--fw-bold);
  }
  .day[data-state="date"],
  .swatch[data-state="date"] {
    background: var(--paper);
    border: var(--rule-w) solid var(--ticket-ink, var(--ink));
    box-shadow: inset 0 0 0 2px var(--ticket);
    font-weight: var(--fw-bold);
  }
  .day[data-state="skipped"],
  .swatch[data-state="skipped"] {
    border: var(--hair-w) dashed var(--ink-3);
    color: var(--ink-3);
    text-decoration: line-through;
  }
  .day[data-state="rule"]:disabled,
  .day[data-state="date"]:disabled {
    opacity: 0.55;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) 2ch;
    margin-top: var(--s-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.75ch;
  }
  .swatch {
    display: inline-block;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: var(--radius);
  }

  .plan {
    border-top: var(--rule-w) solid var(--rule);
    border-bottom: var(--rule-w) solid var(--rule);
  }
  .plan li {
    grid-template-columns: 14ch minmax(0, 1fr);
    padding-inline: 0;
  }
  .plan-day {
    font-weight: var(--fw-bold);
    white-space: nowrap;
  }
  .plan li[data-state="done"] .plan-day {
    color: var(--ink-3);
    font-weight: var(--fw-regular);
  }
</style>
