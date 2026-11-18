<script lang="ts">
  import { enhance } from "$app/forms";
  import { importError, MAX_IMPORT_CHARS, parseTable, suggestColumns, toEntries, type Limits } from "#lib/import/table.ts";

  type Imported = { names: number; tickets: number; skipped: number };
  let { limits, imported }: { limits: Limits; imported?: Imported } = $props();

  const PREVIEW_ROWS = 8;
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
  const letter = (i: number): string => (i < 26 ? "" : letter(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));

  let raw = $state("");
  let fileName = $state("");
  let fileError = $state("");
  let busy = $state(false);
  // Opens after a no-JS import so the result shows; after that it's the host's to toggle.
  // svelte-ignore state_referenced_locally
  let open = $state(Boolean(imported));

  const table = $derived(parseTable(raw.length > MAX_IMPORT_CHARS ? "" : raw));
  const suggested = $derived(suggestColumns(table));
  // The host's picks; they go back to the suggestion whenever the text changes.
  let header = $derived(suggested.header);
  let nameCol = $derived(String(suggested.name));
  let countCol = $derived(suggested.count === null ? "" : String(suggested.count));

  const cols = $derived({ header, name: Number(nameCol), count: countCol === "" ? null : Number(countCol) });
  const result = $derived(toEntries(table, cols));
  const problem = $derived.by(() => {
    if (raw.length > MAX_IMPORT_CHARS) return "That's too much to import; keep it under 1 MB.";
    if (table.rows.length === 0) return null;
    if (cols.count === cols.name) return "Pick different columns for names and tickets.";
    return importError(result, limits);
  });
  const titles = $derived(
    Array.from({ length: table.width }, (_, i) => (header && table.rows[0][i]?.trim()) || `Column ${letter(i)}`),
  );
  const dataRows = $derived(header ? table.rows.slice(1) : table.rows);
  const preview = $derived(dataRows.slice(0, PREVIEW_ROWS));
  const firstRow = $derived(header ? 2 : 1);
  const badRows = $derived(new Set(result.problems.map((p) => p.row)));

  async function readFile(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    fileError = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) {
      fileError = "That file is too big; import at most 1 MB.";
      input.value = "";
      return;
    }
    raw = await file.text();
    fileName = file.name;
    // The text goes up from the box, so the file isn't sent twice.
    input.value = "";
  }
</script>

<details class="more import" bind:open>
  <summary class="small">Import from a spreadsheet or CSV</summary>
  <form
    method="POST"
    action="?/importNames"
    enctype="multipart/form-data"
    class="form"
    use:enhance={() => {
      busy = true;
      return async ({ result: res, update }) => {
        await update();
        busy = false;
        if (res.type === "success") {
          raw = "";
          fileName = "";
        }
      };
    }}
  >
    <div class="field">
      <label for="import-table">Paste rows</label>
      <textarea
        class="textarea mono"
        id="import-table"
        name="table"
        rows="4"
        spellcheck="false"
        placeholder="Copy cells from Excel or Google Sheets, or lines of a CSV, and paste them here"
        aria-describedby="import-hint"
        bind:value={raw}
        oninput={() => (fileName = "")}
      ></textarea>
      <p class="hint" id="import-hint">
        Tabs, commas or semicolons between columns. A header row is optional. Repeated names are combined.
      </p>
    </div>

    <div class="field">
      <label for="import-file">Or choose a file</label>
      <input
        class="file"
        id="import-file"
        name="file"
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        aria-describedby={fileError ? "import-file-error" : fileName ? "import-file-name" : undefined}
        onchange={readFile}
      />
      {#if fileError}
        <p class="field-error" id="import-file-error" role="alert">{fileError}</p>
      {:else if fileName}
        <p class="hint" id="import-file-name">Read {fileName}. Check the preview below.</p>
      {/if}
    </div>

    {#if table.rows.length > 0}
      <div class="pickers">
        <div class="field">
          <label for="import-name">Names are in</label>
          <select class="select" id="import-name" name="nameCol" bind:value={nameCol}>
            {#each titles as t, i (i)}<option value={String(i)}>{t}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="import-count">Tickets are in <span class="optional">(optional)</span></label>
          <select class="select" id="import-count" name="countCol" bind:value={countCol}>
            <option value="">No column: one each</option>
            {#each titles as t, i (i)}<option value={String(i)}>{t}</option>{/each}
          </select>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={header} />
          <span>First row is a header</span>
        </label>
        <input type="hidden" name="header" value={header ? "1" : "0"} />
      </div>

      <div class="table-wrap">
        <table class="table preview">
          <caption>
            Preview{dataRows.length > PREVIEW_ROWS ? `: first ${PREVIEW_ROWS} of ${plural(dataRows.length, "row")}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col" class="w-min num"><span class="sr-only">Row</span></th>
              {#each titles as t, i (i)}
                <th scope="col" class:picked={i === cols.name || i === cols.count} class:num={i === cols.count}>
                  {t}
                  {#if i === cols.name && !/\bnames?\b/i.test(t)}<span class="role">name</span>
                  {:else if i === cols.count && !/\btickets?\b/i.test(t)}<span class="role">tickets</span>{/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each preview as row, r (r)}
              <tr class:bad={badRows.has(r + firstRow)}>
                <td class="w-min num meta">{r + firstRow}</td>
                {#each row as cell, i (i)}
                  <td class:picked={i === cols.name || i === cols.count} class:num={i === cols.count}>{cell}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="btn-row">
      <button class="btn" disabled={busy || table.rows.length === 0 || problem !== null}>
        {busy ? "Importing…" : "Import"}
      </button>
      <span aria-live="polite">
        {#if problem}
          <span class="field-error">{problem}</span>
        {:else if table.rows.length > 0}
          <span class="hint">
            {plural(result.entries.length, "name")}, {plural(result.tickets, "ticket")}{#if result.skipped}; skipping {plural(
                result.skipped,
                "row",
              )} with no name or 0 tickets{/if}.
          </span>
        {:else if imported}
          <span class="status" data-tone="ok">
            imported {plural(imported.names, "name")}{#if imported.tickets !== imported.names}, {plural(imported.tickets, "ticket")}{/if}
          </span>
        {/if}
      </span>
    </div>
  </form>
</details>

<style>
  .import form {
    margin-top: var(--lh);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    white-space: pre;
    overflow-x: auto;
  }
  .file {
    font: inherit;
    font-size: var(--fs-sm);
    max-width: 100%;
  }
  .file::file-selector-button {
    font: inherit;
    margin-right: 1.5ch;
    min-height: 1.75rem;
    padding-inline: 1ch;
    border: var(--rule-w) solid var(--ink);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  .file::file-selector-button:hover {
    background: var(--paper-sunk);
  }
  .pickers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22ch), 1fr));
    gap: var(--s-2) var(--gutter);
    align-items: end;
  }
  .pickers .check {
    padding-bottom: var(--s-1);
  }
  .preview {
    font-size: var(--fs-sm);
  }
  .preview caption {
    padding-top: 0;
  }
  .preview th,
  .preview td {
    white-space: nowrap;
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .preview tbody td {
    color: var(--ink-3);
  }
  .preview tbody td.picked {
    color: var(--ink);
  }
  .preview thead th.picked {
    color: var(--ink);
  }
  .role {
    margin-left: 0.5ch;
    font-weight: var(--fw-regular);
    color: var(--mark);
  }
  .role::before {
    content: "· ";
  }
  .preview tr.bad td {
    background: var(--fail-wash);
  }
</style>
