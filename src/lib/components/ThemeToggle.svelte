<!--
  Theme (palette) picker plus the light / auto / dark toggle. The two are
  independent: the palette is data-palette on <html> (absent = VRF Hat), the
  mode is data-theme (absent = auto, the OS decides). src/app.html applies
  both from localStorage before first paint.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type Mode = "light" | "auto" | "dark";
  type Palette = "vrf" | "von" | "cwl";
  const palettes: { value: Palette; label: string }[] = [
    { value: "vrf", label: "VRF Hat" },
    { value: "von", label: "von" },
    { value: "cwl", label: "CWL" },
  ];

  let mode = $state<Mode>("auto");
  let palette = $state<Palette>("vrf");

  onMount(() => {
    const root = document.documentElement;
    const t = root.getAttribute("data-theme");
    mode = t === "light" || t === "dark" ? t : "auto";
    const p = root.getAttribute("data-palette");
    palette = p === "von" || p === "cwl" ? p : "vrf";
  });

  /** Set or clear an attribute on <html> and remember it; null means the default. */
  function apply(attr: string, key: string, value: string | null) {
    const root = document.documentElement;
    if (value === null) root.removeAttribute(attr);
    else root.setAttribute(attr, value);
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  function setMode(next: Mode) {
    mode = next;
    apply("data-theme", "von-theme", next === "auto" ? null : next);
  }

  function setPalette(next: Palette) {
    palette = next;
    apply("data-palette", "vrf-hat-palette", next === "vrf" ? null : next);
  }
</script>

<div class="theme-controls">
  <label class="palette">
    <span class="visually-hidden">Theme</span>
    <select class="select" value={palette} onchange={(e) => setPalette(e.currentTarget.value as Palette)}>
      {#each palettes as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>
  <fieldset class="segmented theme-toggle">
    <legend>Colour mode</legend>
    {#each ["light", "auto", "dark"] as const as option (option)}
      <label>
        <input type="radio" name="theme" value={option} checked={mode === option} onchange={() => setMode(option)} />
        <span>{option}</span>
      </label>
    {/each}
  </fieldset>
</div>

<style>
  .theme-controls {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) 1ch;
  }
  /* Same height and frame as the segmented toggle beside it. */
  .palette .select {
    width: auto;
    min-height: 1.75rem;
    padding-left: 1ch;
    border: var(--rule-w) solid var(--ink);
    font-size: var(--fs-sm);
    line-height: calc(1.75rem - var(--rule-w) * 2);
  }
</style>
