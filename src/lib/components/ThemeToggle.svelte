<!-- light / auto / dark. Auto removes data-theme so the OS decides. -->
<script lang="ts">
  import { onMount } from "svelte";

  type Theme = "light" | "auto" | "dark";
  let theme = $state<Theme>("auto");

  onMount(() => {
    const t = document.documentElement.getAttribute("data-theme");
    theme = t === "light" || t === "dark" ? t : "auto";
  });

  function set(next: Theme) {
    theme = next;
    const root = document.documentElement;
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "auto") localStorage.removeItem("von-theme");
      else localStorage.setItem("von-theme", next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
</script>

<fieldset class="segmented theme-toggle">
  <legend>Theme</legend>
  {#each ["light", "auto", "dark"] as const as option (option)}
    <label>
      <input type="radio" name="theme" value={option} checked={theme === option} onchange={() => set(option)} />
      <span>{option}</span>
    </label>
  {/each}
</fieldset>
