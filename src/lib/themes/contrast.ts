// Reads the theme CSS (palette.css and src/lib/themes/*.css), resolves each
// theme's colour roles for light and dark, and computes WCAG 2 contrast
// ratios for the pairs the UI actually renders. Used by contrast.test.ts and
// scripts/theme-contrast.ts; it has no DOM or Vite dependency.

export type Mode = "light" | "dark" | "auto-dark";
export type Tokens = Record<string, string>;

/** Every colour role a theme must define, in each of light, dark and auto-dark. */
export const ROLES = [
  "paper",
  "paper-sunk",
  "paper-raised",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "line-strong",
  "rule",
  "mark",
  "mark-fill",
  "on-mark",
  "mark-wash",
  "link",
  "link-hover",
  "focus",
  "ticket",
  "ticket-ink",
  "ok",
  "ok-wash",
  "ok-line",
  "run",
  "run-wash",
  "run-line",
  "warn",
  "warn-wash",
  "warn-line",
  "fail",
  "fail-wash",
  "fail-line",
  "scrim",
  "shadow-pop",
] as const;

export interface ThemeSource {
  id: string;
  name: string;
  /** Path relative to src/lib. */
  file: string;
  selectors: Record<Mode, string>;
}

const AUTO = "@media (prefers-color-scheme: dark)";

export const THEMES: ThemeSource[] = [
  {
    id: "vrf",
    name: "VRF Hat",
    file: "palette.css",
    selectors: {
      light: ":root",
      dark: ':root[data-theme="dark"]',
      "auto-dark": `${AUTO} :root:not([data-theme="light"])`,
    },
  },
  ...[
    ["von", "von"],
    ["cwl", "CWL"],
  ].map(([id, name]) => ({
    id,
    name,
    file: `themes/${id}.css`,
    selectors: {
      light: `:root[data-palette="${id}"]`,
      dark: `:root[data-palette="${id}"][data-theme="dark"]`,
      "auto-dark": `${AUTO} :root[data-palette="${id}"]:not([data-theme="light"])`,
    },
  })),
];

/**
 * Custom-property declarations per rule, keyed by the selector path
 * (an at-rule prelude and the selector joined by a space). Only flat
 * `--name: value;` declarations are read; that is all theme files contain.
 */
export function parseBlocks(css: string): Map<string, Tokens> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, Tokens>();
  const stack: string[] = [];
  let buf = "";
  const flush = () => {
    const decl = buf.trim();
    buf = "";
    const m = /^--([\w-]+)\s*:\s*([\s\S]+)$/.exec(decl);
    if (!m || stack.length === 0) return;
    const key = stack.join(" ");
    const tokens = blocks.get(key) ?? {};
    tokens[m[1]] = m[2].trim().replace(/\s+/g, " ");
    blocks.set(key, tokens);
  };
  for (const ch of src) {
    if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (ch === "}") {
      flush();
      stack.pop();
    } else if (ch === ";") {
      flush();
    } else {
      buf += ch;
    }
  }
  return blocks;
}

/** Resolve var(--x) references within one token set. */
export function resolve(tokens: Tokens): Tokens {
  const out: Tokens = {};
  const get = (name: string, seen: Set<string>): string | undefined => {
    const raw = tokens[name];
    if (raw === undefined || seen.has(name)) return undefined;
    seen.add(name);
    return raw.replace(/var\(--([\w-]+)\)/g, (whole, ref: string) => get(ref, seen) ?? whole);
  };
  for (const name of Object.keys(tokens)) out[name] = get(name, new Set()) ?? tokens[name];
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a #rgb/#rrggbb colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** [foreground role, background role, minimum ratio, what it is]. */
export const PAIRS: [string, string, number, string][] = [
  ...["paper", "paper-sunk", "paper-raised"].flatMap((bg): [string, string, number, string][] => [
    ["ink", bg, 4.5, "body text"],
    ["ink-2", bg, 4.5, "secondary text"],
    ["ink-3", bg, 4.5, "meta text"],
    ["link", bg, 4.5, "link"],
    ["mark", bg, 4.5, "mark text"],
    ["ok", bg, 4.5, "status ok"],
    ["run", bg, 4.5, "status run"],
    ["warn", bg, 4.5, "status warn"],
    ["fail", bg, 4.5, "status fail / field error"],
    ["line-strong", bg, 3, "control boundary"],
    ["focus", bg, 3, "focus ring"],
  ]),
  ["ok", "ok-wash", 4.5, "status on own wash"],
  ["run", "run-wash", 4.5, "status on own wash"],
  ["warn", "warn-wash", 4.5, "warn status chip"],
  ["fail", "fail-wash", 4.5, "status on own wash"],
  ["ink", "ok-wash", 4.5, "notice text"],
  ["ink", "run-wash", 4.5, "notice text"],
  ["ink", "warn-wash", 4.5, "notice text"],
  ["ink", "fail-wash", 4.5, "notice / failed step text"],
  ["ink", "mark-wash", 4.5, "selected row text"],
  ["mark", "mark-wash", 4.5, "selected row link"],
  ["paper", "fail", 4.5, "fail status chip"],
  ["on-mark", "mark-fill", 4.5, "primary button"],
  ["ticket-ink", "ticket", 4.5, "drawn ticket, selection, checked toggle"],
  ["ink", "paper-raised", 4.5, "undrawn ticket"],
];

export interface Row {
  theme: string;
  mode: Mode;
  fg: string;
  bg: string;
  label: string;
  min: number;
  ratio: number;
  pass: boolean;
}

/** Load a theme's resolved tokens per mode from its CSS text. */
export function themeTokens(theme: ThemeSource, css: string): Record<Mode, Tokens> {
  const blocks = parseBlocks(css);
  const out = {} as Record<Mode, Tokens>;
  for (const [mode, selector] of Object.entries(theme.selectors) as [Mode, string][]) {
    const block = blocks.get(selector);
    if (!block) throw new Error(`${theme.file}: no block for ${selector}`);
    out[mode] = resolve(block);
  }
  return out;
}

export function checkTheme(theme: ThemeSource, css: string): Row[] {
  const tokens = themeTokens(theme, css);
  const rows: Row[] = [];
  for (const mode of ["light", "dark", "auto-dark"] as Mode[]) {
    for (const [fg, bg, min, label] of PAIRS) {
      const ratio = contrast(tokens[mode][fg], tokens[mode][bg]);
      rows.push({ theme: theme.id, mode, fg, bg, label, min, ratio, pass: ratio >= min });
    }
  }
  return rows;
}
