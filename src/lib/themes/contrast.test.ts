import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { checkTheme, contrast, parseBlocks, ROLES, THEMES, themeTokens } from "./contrast.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("keys blocks nested in @media by prelude and selector", () => {
    const blocks = parseBlocks("a { --x: #fff; } @media (y) { b:not(c) { --z: 1px 2px; } }");
    expect(blocks.get("a")).toEqual({ x: "#fff" });
    expect(blocks.get("@media (y) b:not(c)")).toEqual({ z: "1px 2px" });
  });
});

describe.each(THEMES)("$name theme", (theme) => {
  const css = read(theme.file);
  const tokens = themeTokens(theme, css);

  it.each(["light", "dark", "auto-dark"] as const)("defines every colour role in %s", (mode) => {
    expect(ROLES.filter((role) => !(role in tokens[mode]))).toEqual([]);
  });

  it("keeps the explicit and automatic dark blocks identical", () => {
    expect(tokens["auto-dark"]).toEqual(tokens.dark);
  });

  it("meets WCAG AA for text, status, ticket and control pairs", () => {
    const failing = checkTheme(theme, css)
      .filter((r) => !r.pass)
      .map((r) => `${r.mode}: ${r.fg} on ${r.bg} ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failing).toEqual([]);
  });
});
