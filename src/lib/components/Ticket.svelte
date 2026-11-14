<!-- A raffle ticket, typed and ruled: the name, a perforation, and the numbered stub. -->
<script lang="ts">
  let {
    number,
    stub,
    label,
    size = "md",
    tone = "ticket",
  }: {
    /** Ticket number, shown as "No. 0001". */
    number?: string;
    /** Stub text for a ticket that has no single number. */
    stub?: string;
    label: string;
    size?: "sm" | "md" | "lg";
    tone?: "ticket" | "plain";
  } = $props();
</script>

<div class="ticket {size}" class:drawn={tone === "ticket"}>
  <span class="name">{label}</span>
  {#if number}
    <span class="stub" aria-label="Ticket number {number}">No.&nbsp;{number}</span>
  {:else if stub}
    <span class="stub">{stub}</span>
  {/if}
</div>

<style>
  .ticket {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    border: var(--rule-w) solid var(--ink);
    background: var(--paper-raised);
    color: var(--ink);
    line-height: var(--lh);
  }
  /* A drawn ticket is ticket yellow. */
  .drawn {
    background: var(--ticket);
    border-color: var(--ticket);
    color: var(--ticket-ink);
  }
  .name {
    min-width: 0;
    padding: var(--s-1) 1.5ch;
    font-weight: var(--fw-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stub {
    flex: none;
    display: grid;
    place-items: center;
    padding: 0 1ch;
    border-left: var(--rule-w) dashed currentColor;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums lining-nums;
    white-space: nowrap;
  }
  .sm {
    font-size: var(--fs-sm);
    line-height: var(--lh-tight);
  }
  .sm .name {
    padding: var(--s-1) 1ch;
  }
  .lg {
    font-size: var(--fs-lg);
  }
  .lg .name {
    padding: var(--s-3) 2ch;
    font-weight: var(--fw-heavy);
    letter-spacing: var(--tracking-title);
  }
  .lg .stub {
    padding: 0 1.5ch;
  }
</style>
