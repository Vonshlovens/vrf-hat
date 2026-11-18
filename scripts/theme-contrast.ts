// Prints WCAG contrast ratios for every theme and mode, from the token values
// in the theme CSS. Exits non-zero if any pair is below its minimum.
//   node scripts/theme-contrast.ts [--all]
// Without --all, prints one line per theme/mode plus any failures.
import { readFileSync } from "node:fs";
import { checkTheme, THEMES } from "#lib/themes/contrast.ts";

const all = process.argv.includes("--all");
let failed = 0;
for (const theme of THEMES) {
  const css = readFileSync(new URL(`../src/lib/${theme.file}`, import.meta.url), "utf8");
  const rows = checkTheme(theme, css);
  for (const mode of ["light", "dark", "auto-dark"] as const) {
    const mine = rows.filter((r) => r.mode === mode);
    const worst = mine.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a));
    const bad = mine.filter((r) => !r.pass);
    failed += bad.length;
    console.log(
      `${theme.name} ${mode}: ${mine.length - bad.length}/${mine.length} pass; ` +
        `tightest ${worst.fg} on ${worst.bg} ${worst.ratio.toFixed(2)} (min ${worst.min})`,
    );
    for (const r of all ? mine : bad) {
      console.log(
        `  ${r.pass ? "ok  " : "FAIL"} ${r.ratio.toFixed(2).padStart(5)} ≥ ${r.min}  ${r.fg} on ${r.bg}  (${r.label})`,
      );
    }
  }
}
if (failed) {
  console.error(`${failed} pair(s) below minimum`);
  process.exit(1);
}
