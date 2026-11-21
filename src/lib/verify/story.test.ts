import { describe, expect, it } from "vite-plus/test";
import type { CommittedEntrant } from "#lib/draw/commitment.ts";
import type { StepStatus, VerifyResult } from "./run.ts";
import { buildStory, gapText, pullsOf, slotsOf, ticketNumber } from "./story.ts";

const ids = ["seal", "request", "proof", "winners"] as const;

function result(statuses: StepStatus[], error?: string): VerifyResult {
  return {
    steps: ids.map((id, i) => ({
      id,
      title: id,
      summary: "",
      status: statuses[i],
      facts: [],
      checks: [],
    })),
    entrants: [],
    root: null,
    shuffle: [],
    timeline: {
      sealedAt: null,
      retried: false,
      requestHref: null,
      drawnAt: null,
      fulfilHref: null,
      contractHref: null,
      mock: false,
      picks: [],
    },
    error,
  };
}

describe("buildStory", () => {
  it("is checking before any result arrives", () => {
    expect(buildStory(null, true)).toEqual({
      verdict: "run",
      sealed: "run",
      random: "run",
      pulled: "run",
    });
  });

  it("passes when every step passes", () => {
    expect(buildStory(result(["pass", "pass", "pass", "pass"]), false)).toEqual({
      verdict: "ok",
      sealed: "ok",
      random: "ok",
      pulled: "ok",
    });
  });

  it("shows progress while later steps are still running", () => {
    const s = buildStory(result(["pass", "pass", "pending", "pending"]), true);
    expect(s).toEqual({ verdict: "run", sealed: "ok", random: "run", pulled: "run" });
  });

  it("needs both the fingerprint match and the request to call the list sealed", () => {
    expect(buildStory(result(["pass", "fail", "fail", "fail"]), false).sealed).toBe("fail");
    expect(buildStory(result(["fail", "pass", "pass", "pass"]), false).sealed).toBe("fail");
    expect(buildStory(result(["pass", "pending", "pending", "pending"]), true).sealed).toBe("run");
  });

  it("fails the verdict when any step fails, or on an error", () => {
    expect(buildStory(result(["pass", "pass", "pass", "fail"]), false).verdict).toBe("fail");
    expect(buildStory(result(["pass", "pass", "pass", "pass"], "boom"), false).verdict).toBe(
      "fail",
    );
  });

  it("waits for Chainlink when the number hasn't arrived", () => {
    expect(buildStory(result(["pass", "pass", "pending", "pending"]), false)).toEqual({
      verdict: "wait",
      sealed: "ok",
      random: "wait",
      pulled: "wait",
    });
  });

  it("treats a skipped proof (local test chain) as not failing", () => {
    expect(buildStory(result(["pass", "pass", "skip", "pass"]), false)).toEqual({
      verdict: "ok",
      sealed: "ok",
      random: "skip",
      pulled: "ok",
    });
  });
});

describe("gapText", () => {
  it("picks a readable unit", () => {
    expect(gapText(1)).toBe("1 second");
    expect(gapText(42)).toBe("42 seconds");
    expect(gapText(89)).toBe("89 seconds");
    expect(gapText(90)).toBe("about 2 minutes");
    expect(gapText(60 * 60)).toBe("about 60 minutes");
    expect(gapText(3 * 3600)).toBe("about 3 hours");
    expect(gapText(5 * 86400)).toBe("about 5 days");
    expect(gapText(-3)).toBe("0 seconds");
  });
});

const list: CommittedEntrant[] = [
  { index: 0, ticket: "0xaa", label: "Ada" },
  { index: 1, ticket: "0xBB", label: "Ben" },
  { index: 2, ticket: "0xbb", label: "Ben" },
  { index: 3, ticket: "0xcc", label: "Cy" },
] as CommittedEntrant[];

describe("slotsOf", () => {
  it("finds every slot of an entry, ignoring hex case", () => {
    expect(slotsOf(list, "0xbb")).toEqual([1, 2]);
    expect(slotsOf(list, "0xAA")).toEqual([0]);
    expect(slotsOf(list, "0xdd")).toEqual([]);
  });
});

describe("pullsOf", () => {
  it("keeps pull order, numbers tickets like the raffle page and marks the viewer's", () => {
    expect(pullsOf([3, 1], list, [1, 2])).toEqual([
      { order: 0, position: 3, number: "0004", label: "Cy", mine: false },
      { order: 1, position: 1, number: "0002", label: "Ben", mine: true },
    ]);
  });

  it("copes with a position outside the list", () => {
    expect(pullsOf([9], list)[0].label).toBe("?");
  });

  it("formats ticket numbers", () => {
    expect(ticketNumber(0)).toBe("0001");
    expect(ticketNumber(12344)).toBe("12345");
  });
});
