<!-- A raffle ticket: body + perforated stub with the ticket number. -->
<script lang="ts">
  let {
    number,
    label,
    size = "md",
    tone = "ticket",
  }: { number: string; label: string; size?: "sm" | "md" | "lg"; tone?: "ticket" | "plain" } = $props();
</script>

<div class="ticket {size} {tone}">
  <span class="label">{label}</span>
  <span class="stub" aria-label="Ticket number {number}">No. {number}</span>
</div>

<style>
  .ticket {
    --notch: 6px;
    --fill: var(--ticket);
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    color: var(--ticket-ink);
  }
  .plain {
    --fill: var(--surface);
    color: var(--ink);
  }
  /* Each half cuts its own half-notch, so the notches always sit on the perforation. */
  .label,
  .stub {
    background: var(--fill);
  }
  .label {
    padding: 0.45em 0.9em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    border-radius: 3px 0 0 3px;
    mask:
      radial-gradient(circle var(--notch) at 100% 0, #0000 98%, #000) top / 100% 51% no-repeat,
      radial-gradient(circle var(--notch) at 100% 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  }
  .stub {
    flex: none;
    display: grid;
    place-items: center;
    padding: 0 0.7em;
    border-radius: 0 3px 3px 0;
    font-family: var(--mono);
    font-size: 0.78em;
    white-space: nowrap;
    background-image: linear-gradient(currentColor 50%, transparent 0);
    background-size: 1.5px 6px;
    background-repeat: repeat-y;
    background-position: 0 0;
    background-origin: border-box;
    mask:
      radial-gradient(circle var(--notch) at 0 0, #0000 98%, #000) top / 100% 51% no-repeat,
      radial-gradient(circle var(--notch) at 0 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  }
  .stub {
    background-color: var(--fill);
  }
  .sm {
    font-size: var(--t-sm);
    --notch: 5px;
  }
  .lg {
    font-size: var(--t-lg);
    --notch: 11px;
  }
  .lg .label {
    padding: 0.55em 1em;
    font-weight: 700;
    letter-spacing: -0.015em;
  }
</style>
