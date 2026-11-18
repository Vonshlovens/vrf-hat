// Reads entrants out of a CSV file or rows pasted from Excel / Google Sheets.
// Pure, so the browser's preview and the server's import agree.
import { normalizeLabel } from "#lib/draw/commitment.ts";
import { parseNameLine } from "#lib/draw/rounds.ts";

export type Delimiter = "\t" | ";" | "," | "|";

export type Table = {
  /** The separator the text uses; null when every line is a single cell. */
  delimiter: Delimiter | null;
  /** Non-blank rows, each padded to `width` cells. */
  rows: string[][];
  width: number;
};

/** Which columns hold what. Column numbers are 0-based; `count` null means one ticket each. */
export type Columns = { header: boolean; name: number; count: number | null };

export type Imported = {
  /** One per distinct name, in first-seen order, with duplicate rows summed. */
  entries: { label: string; count: number }[];
  tickets: number;
  /** Data rows skipped because the name was blank or the count was 0. */
  skipped: number;
  /** Rows whose count can't be read. 1-based row numbers, counting a header row. */
  problems: { row: number; message: string }[];
};

/** Longest text the server will read: about a megabyte. */
export const MAX_IMPORT_CHARS = 1_000_000;

// Tab first: a paste from a spreadsheet always uses tabs. Semicolon before
// comma: files that use semicolons often have commas inside names or numbers.
const DELIMITERS: Delimiter[] = ["\t", ";", ",", "|"];
const SAMPLE_LINES = 50;

/** Splits `text` into rows of cells. Handles "quoted, fields", "" escapes and line breaks in quotes. */
export function parseRows(text: string, delimiter: Delimiter | null): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  const endCell = () => {
    row.push(quoted ? cell : cell.trim());
    cell = "";
    quoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "" && !quoted) {
      // A quote opens a quoted field only at the start of a cell.
      inQuotes = true;
      quoted = true;
      cell = "";
    } else if (c === delimiter) {
      endCell();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else if (!quoted) {
      cell += c;
    }
    // Text after a closing quote (`"a"b`) is dropped, as spreadsheets do.
  }
  if (cell !== "" || quoted || row.length > 0) {
    endCell();
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Guesses the separator: the one that splits the first lines into the same number of cells most often. */
export function sniffDelimiter(text: string): Delimiter | null {
  const sample = text.split(/\r?\n|\r/, SAMPLE_LINES * 4).join("\n");
  let best: Delimiter | null = null;
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const widths = parseRows(sample, d)
      .slice(0, SAMPLE_LINES)
      .map((r) => r.length);
    if (widths.length === 0) continue;
    const tally = new Map<number, number>();
    for (const w of widths) tally.set(w, (tally.get(w) ?? 0) + 1);
    let mode = 1;
    let modeCount = 0;
    for (const [w, n] of tally) {
      if (w > 1 && n > modeCount) [mode, modeCount] = [w, n];
    }
    if (mode < 2) continue;
    const score = modeCount / widths.length;
    // Strictly better only: ties go to the earlier, likelier delimiter.
    if (score > bestScore + 1e-9) [best, bestScore] = [d, score];
  }
  return best;
}

function spacedColumns(text: string): boolean {
  const lines = text
    .split(/\r?\n|\r/, SAMPLE_LINES * 4)
    .filter((l) => l.trim())
    .slice(0, SAMPLE_LINES);
  if (lines.length === 0) return false;
  const spaced = lines.filter((l) => / {2,}\S/.test(l.trimEnd())).length;
  return spaced / lines.length >= 0.8;
}

/** Reads pasted or uploaded text into a table. */
export function parseTable(text: string): Table {
  let delimiter = sniffDelimiter(text);
  // Tabs often turn into runs of spaces on the way (a terminal, some mail and
  // chat apps). With no other delimiter, read 2+ spaces as a column break,
  // but only if most lines have one, so a plain list with the odd double
  // space between first and last name stays one column.
  if (!delimiter && spacedColumns(text)) {
    text = text.replace(/ {2,}/g, "\t");
    delimiter = "\t";
  }
  const rows = parseRows(text, delimiter);
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) while (r.length < width) r.push("");
  return { delimiter, rows, width };
}

// ------------------------------------------------------------------ columns

const NAME_WORDS = new Set([
  "name",
  "names",
  "team",
  "teams",
  "player",
  "players",
  "participant",
  "participants",
  "entrant",
  "entrants",
  "person",
  "people",
  "member",
  "members",
  "who",
]);
const COUNT_WORDS = new Set([
  "ticket",
  "tickets",
  "entries",
  "qty",
  "quantity",
  "count",
  "chance",
  "chances",
  "number of tickets",
  "number of entries",
  "no of tickets",
  "no of entries",
  "tickets bought",
]);

const words = (cell: string) =>
  cell
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function headerKind(cell: string): "name" | "count" | null {
  const w = words(cell);
  if (!w) return null;
  if (COUNT_WORDS.has(w)) return "count";
  if (NAME_WORDS.has(w)) return "name";
  const parts = w.split(" ");
  // "# tickets", "Ticket count", "Team name", "Full name", "Player (first + last)".
  if (parts.some((p) => COUNT_WORDS.has(p))) return "count";
  if (parts.some((p) => NAME_WORDS.has(p))) return "name";
  return null;
}

/** A ticket count as typed in a sheet: "3", " 12 ", "1,000". Null if it isn't one. */
export function readCount(cell: string): number | null {
  const t = cell.trim().replace(/^(\d{1,3})(?:[ ,](\d{3}))+$/, (m) => m.replace(/[ ,]/g, ""));
  if (/^\d+(\.0+)?$/.test(t)) return Number.parseInt(t, 10);
  return null;
}

const isWhole = (cell: string) => readCount(cell) !== null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function column(rows: string[][], i: number) {
  return rows.map((r) => r[i] ?? "").filter((c) => c.trim() !== "");
}

/** True when the first row looks like column titles rather than an entrant. */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const [first, ...rest] = rows;
  // A cell that is just a title word ("Name", "Tickets"). "Team Rocket" could be an entrant, so
  // partial matches only count when every cell in the row is one ("Team name", "# of tickets").
  if (first.some((c) => NAME_WORDS.has(words(c)) || COUNT_WORDS.has(words(c)))) return true;
  const filled = first.filter((c) => c.trim() !== "");
  if (filled.length > 1 && filled.every((c) => headerKind(c) !== null)) return true;
  if (rest.length === 0) return false;
  // A column of numbers under a word is a title over data.
  return first.some((c, i) => {
    const below = column(rest, i);
    return c.trim() !== "" && !isWhole(c) && below.length > 0 && below.every(isWhole);
  });
}

/** Picks the name and ticket-count columns, from header titles if there are any, else from the data. */
export function suggestColumns(table: Table): Columns {
  const header = looksLikeHeader(table.rows);
  const titles = header ? table.rows[0] : [];
  const data = header ? table.rows.slice(1) : table.rows;
  let name = titles.findIndex((c) => headerKind(c) === "name");
  let count: number | null = titles.findIndex((c) => headerKind(c) === "count");
  if (count === -1) count = null;

  const cols = Array.from({ length: table.width }, (_, i) => column(data, i));
  const numeric = (i: number) => cols[i].length > 0 && cols[i].every(isWhole);
  if (name === -1 || name === count) {
    // The first column of words that aren't email addresses, else the first with words.
    const wordy = (i: number) => i !== count && cols[i].length > 0 && !numeric(i);
    name = cols.findIndex((c, i) => wordy(i) && !c.every((v) => EMAIL.test(v.trim())));
    if (name === -1) name = cols.findIndex((_, i) => wordy(i));
    if (name === -1) name = count === 0 ? Math.min(1, table.width - 1) : 0;
  }
  // Without titles, a column of whole numbers is most likely the count. With
  // titles that don't say so, it could as well be a score or an age.
  if (count === null && !header && table.width > 1) {
    const i = cols.findIndex((_, i) => i !== name && numeric(i));
    if (i !== -1) count = i;
  }
  return { header, name: Math.max(0, name), count };
}

// ------------------------------------------------------------------ entries

/**
 * Turns table rows into entries. Duplicate names (after the same normalising
 * the hat applies) are merged and their tickets summed. Without a count
 * column, "Name x3" in the name cell still gives three tickets.
 */
export function toEntries(table: Table, cols: Columns): Imported {
  const merged = new Map<string, number>();
  const problems: Imported["problems"] = [];
  let skipped = 0;
  const start = cols.header ? 1 : 0;
  for (let i = start; i < table.rows.length; i++) {
    const row = table.rows[i];
    const rawName = row[cols.name] ?? "";
    let label: string;
    let count: number;
    if (cols.count === null) {
      const parsed = parseNameLine(rawName);
      label = normalizeLabel(parsed.label);
      count = parsed.count;
    } else {
      label = normalizeLabel(rawName);
      const raw = (row[cols.count] ?? "").trim();
      const n = raw === "" ? 1 : readCount(raw);
      if (label && n === null) {
        problems.push({ row: i + 1, message: `"${raw}" isn't a whole number of tickets.` });
        continue;
      }
      count = n ?? 1;
    }
    if (!label || count === 0) {
      skipped++;
      continue;
    }
    merged.set(label, (merged.get(label) ?? 0) + count);
  }
  const entries = [...merged].map(([label, count]) => ({ label, count }));
  return { entries, tickets: entries.reduce((sum, e) => sum + e.count, 0), skipped, problems };
}

export type Limits = {
  /** Most tickets one name can hold. */
  perName: number;
  /** Most tickets the hat can hold. */
  total: number;
  /** Most names one import can add. */
  names: number;
  /** Tickets already in the hat. */
  inHat?: number;
};

const fmt = (n: number) => n.toLocaleString("en");

/** What stops this import, in words the host can act on; null if it can go ahead. */
export function importError(result: Imported, limits: Limits): string | null {
  if (result.problems.length > 0) {
    const [p] = result.problems;
    const more = result.problems.length - 1;
    return `Row ${p.row}: ${p.message}${more > 0 ? ` (and ${more} more ${more === 1 ? "row" : "rows"})` : ""}`;
  }
  if (result.entries.length === 0) return "No names found in the chosen column.";
  if (result.entries.length > limits.names) {
    return `That's ${fmt(result.entries.length)} names; import at most ${fmt(limits.names)} at a time.`;
  }
  const over = result.entries.filter((e) => e.count > limits.perName);
  if (over.length > 0) {
    const who = over
      .slice(0, 3)
      .map((e) => `${e.label} (${fmt(e.count)})`)
      .join(", ");
    return `A name can hold at most ${fmt(limits.perName)} tickets: ${who}${over.length > 3 ? ` and ${over.length - 3} more` : ""}.`;
  }
  const total = result.tickets + (limits.inHat ?? 0);
  if (total > limits.total) {
    const room = Math.max(0, limits.total - (limits.inHat ?? 0));
    return `The hat holds at most ${fmt(limits.total)} tickets; this adds ${fmt(result.tickets)} and there's room for ${fmt(room)}.`;
  }
  return null;
}
