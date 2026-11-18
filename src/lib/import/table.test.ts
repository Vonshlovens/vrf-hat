import { describe, expect, it } from "vite-plus/test";
import {
  importError,
  looksLikeHeader,
  parseRows,
  parseTable,
  readCount,
  sniffDelimiter,
  suggestColumns,
  toEntries,
  type Limits,
} from "./table.ts";

const limits: Limits = { perName: 1000, total: 10_000, names: 500 };
const read = (text: string) => {
  const table = parseTable(text);
  const cols = suggestColumns(table);
  return { table, cols, result: toEntries(table, cols) };
};

describe("parseRows", () => {
  it("handles quotes, escaped quotes and line breaks inside quotes", () => {
    const rows = parseRows(
      'name,tickets\n"Patel, Dev",3\n"Ann ""Annie"" Lee",1\n"Two\nLines",2\n',
      ",",
    );
    expect(rows).toEqual([
      ["name", "tickets"],
      ["Patel, Dev", "3"],
      ['Ann "Annie" Lee', "1"],
      ["Two\nLines", "2"],
    ]);
  });

  it("drops blank lines, a BOM and CRLF endings, and trims unquoted cells", () => {
    expect(parseRows("﻿a ; 1\r\n\r\n  b;2\r\n", ";")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("keeps a quote in the middle of a cell", () => {
    expect(parseRows('Dev "DJ" Patel\t2', "\t")).toEqual([['Dev "DJ" Patel', "2"]]);
  });

  it("reads one cell per line without a delimiter", () => {
    expect(parseRows("Ann\nBo x2\n", null)).toEqual([["Ann"], ["Bo x2"]]);
  });
});

describe("sniffDelimiter", () => {
  it("finds tabs from a spreadsheet paste", () => {
    expect(sniffDelimiter("Name\tTickets\nAnn\t2\nBo, Jr.\t1")).toBe("\t");
  });

  it("finds commas", () => {
    expect(sniffDelimiter("name,tickets\nAnn,2\nBo,1")).toBe(",");
  });

  it("prefers semicolons when commas sit inside names", () => {
    expect(sniffDelimiter("Name;Tickets\nPatel, Dev;2\nLee, Ann;1")).toBe(";");
  });

  it("ignores commas inside quotes", () => {
    expect(sniffDelimiter('"Patel, Dev";2\n"Lee, Ann";1')).toBe(";");
  });

  it("returns null for a plain list", () => {
    expect(sniffDelimiter("Ann\nBo\nCy")).toBeNull();
  });
});

describe("readCount", () => {
  it("reads whole numbers as sheets write them", () => {
    expect(readCount(" 12 ")).toBe(12);
    expect(readCount("1,000")).toBe(1000);
    expect(readCount("3.0")).toBe(3);
    expect(readCount("0")).toBe(0);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "-1", "2.5", "three", "1,00", "3x"]) expect(readCount(bad)).toBeNull();
  });
});

describe("headers and column suggestions", () => {
  it("uses header names", () => {
    const { cols } = read("Email\tTeam\tQty\nann@x.io\tRed\t3\nbo@x.io\tBlue\t1");
    expect(cols).toEqual({ header: true, name: 1, count: 2 });
  });

  it("matches titles with extra words", () => {
    const { cols } = read("Full name,# of tickets\nAnn,2\nBo,1");
    expect(cols).toEqual({ header: true, name: 0, count: 1 });
  });

  it("spots a header over a numeric column even without known words", () => {
    const { cols } = read("Who's coming,How many\nAnn,2\nBo,1");
    expect(cols.header).toBe(true);
    expect(cols.count).toBeNull();
    expect(cols.name).toBe(0);
  });

  it("guesses from the data with no header", () => {
    const { cols } = read("3\tAnn\n1\tBo\n2\tCy");
    expect(cols).toEqual({ header: false, name: 1, count: 0 });
  });

  it("skips an email column when guessing the name", () => {
    const { cols } = read("ann@x.io,Ann,2\nbo@x.io,Bo,1");
    expect(cols).toEqual({ header: false, name: 1, count: 2 });
  });

  it("doesn't take an entrant called Team Something for a header", () => {
    expect(
      looksLikeHeader([
        ["Team Rocket", "3"],
        ["Ann", "1"],
      ]),
    ).toBe(false);
    expect(looksLikeHeader([["Team Rocket"], ["Ann"]])).toBe(false);
  });

  it("doesn't call an untitled numeric column a count when the header says otherwise", () => {
    const { cols } = read("Name,Age\nAnn,31\nBo,40");
    expect(cols).toEqual({ header: true, name: 0, count: null });
  });
});

describe("toEntries", () => {
  it("merges duplicate names and sums their tickets", () => {
    const { result } = read("Name,Tickets\nAnn,2\nBo,1\n  ann ,3\nAnn,1");
    // Case differs, so "ann" is a different name; whitespace is normalised.
    expect(result.entries).toEqual([
      { label: "Ann", count: 3 },
      { label: "Bo", count: 1 },
      { label: "ann", count: 3 },
    ]);
    expect(result.tickets).toBe(7);
  });

  it("counts a blank count as one ticket and skips zero and blank names", () => {
    const { result } = read("Name,Tickets\nAnn,\nBo,0\n,4\nCy,2");
    expect(result.entries).toEqual([
      { label: "Ann", count: 1 },
      { label: "Cy", count: 2 },
    ]);
    expect(result.skipped).toBe(2);
  });

  it("reports counts it can't read, by row", () => {
    const { result } = read("Name,Tickets\nAnn,2\nBo,lots");
    expect(result.problems).toEqual([
      { row: 3, message: '"lots" isn\'t a whole number of tickets.' },
    ]);
    expect(importError(result, limits)).toMatch(/^Row 3:/);
  });

  it("reads Name x3 when there's no count column", () => {
    const { result } = read("Ann x3\nBo\nAnn");
    expect(result.entries).toEqual([
      { label: "Ann", count: 4 },
      { label: "Bo", count: 1 },
    ]);
  });

  it("respects a column choice the host makes", () => {
    const table = parseTable("Name,Tickets\nAnn,2\nBo,1");
    expect(toEntries(table, { header: false, name: 1, count: null }).entries).toEqual([
      { label: "Tickets", count: 1 },
      { label: "2", count: 1 },
      { label: "1", count: 1 },
    ]);
  });
});

describe("importError", () => {
  it("passes a normal import", () => {
    expect(importError(read("Ann\t2\nBo\t1").result, limits)).toBeNull();
  });

  it("caps tickets per name after merging", () => {
    const { result } = read("Name,Tickets\nAnn,600\nAnn,600");
    expect(importError(result, limits)).toBe("A name can hold at most 1,000 tickets: Ann (1,200).");
  });

  it("caps the hat, counting what's already in", () => {
    const { result } = read("Name,Tickets\nAnn,900\nBo,900");
    expect(importError(result, { ...limits, total: 2000 })).toBeNull();
    expect(importError(result, { ...limits, total: 2000, inHat: 500 })).toBe(
      "The hat holds at most 2,000 tickets; this adds 1,800 and there's room for 1,500.",
    );
  });

  it("caps names per import", () => {
    const text = Array.from({ length: 6 }, (_, i) => `P${i}`).join("\n");
    expect(importError(read(text).result, { ...limits, names: 5 })).toMatch(/at most 5 at a time/);
  });

  it("says when nothing was found", () => {
    expect(importError(read("Name,Tickets\n,2").result, limits)).toMatch(/No names/);
  });
});
