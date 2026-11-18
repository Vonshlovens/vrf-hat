import { describe, expect, it } from "vite-plus/test";
import {
  buildResultsEmail,
  formatDrawTime,
  mergeRecipients,
  normalizeEmail,
  REMAINING_SHOWN,
  sendOnce,
  type RoundResult,
} from "./results.ts";

const base: RoundResult = {
  origin: "https://hat.example/",
  raffle: {
    slug: "abc23456",
    title: "Office <Lunch> Draw",
    mode: "win",
    recurring: true,
    finished: false,
    timezone: "America/Denver",
    nextDrawAt: new Date("2026-11-20T16:00:00Z"),
  },
  round: 3,
  hostName: "Dana",
  orgName: null,
  pulled: [
    { label: "Ana", position: 6 },
    { label: "Ben", position: 0 },
  ],
  remaining: [
    { label: "Cy", tickets: 1 },
    { label: "Dee", tickets: 3 },
  ],
};
const host = { email: "dana@x.io", reason: "host" as const };

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
  it("rejects things that aren't addresses", () => {
    for (const bad of [
      "",
      "ana",
      "ana@",
      "@x.io",
      "a b@x.io",
      "ana@x",
      "a@x.io, b@y.io",
      "<a@x.io>",
    ]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
    expect(normalizeEmail(`${"a".repeat(250)}@x.io`)).toBeNull();
  });
});

describe("mergeRecipients", () => {
  it("dedupes case-insensitively, host first, then added, then members", () => {
    const got = mergeRecipients({
      host: "Dana@x.io",
      added: ["ana@x.io", "DANA@x.io", "bad", "ana@x.io"],
      members: ["ANA@x.io", "cy@x.io", "dana@x.io"],
    });
    expect(got).toEqual([
      { email: "dana@x.io", reason: "host" },
      { email: "ana@x.io", reason: "added" },
      { email: "cy@x.io", reason: "member" },
    ]);
  });
  it("works without the host", () => {
    expect(mergeRecipients({ host: null, added: ["a@x.io"], members: [] })).toEqual([
      { email: "a@x.io", reason: "added" },
    ]);
  });
});

describe("buildResultsEmail", () => {
  it("lists the round's winners with ticket numbers, who's left, and the links", () => {
    const m = buildResultsEmail(base, host);
    expect(m.to).toBe("dana@x.io");
    expect(m.subject).toBe("Office <Lunch> Draw: round 3 results");
    expect(m.text).toContain("Round 3 has been drawn.");
    expect(m.text).toContain("Winners:\n  No. 0007  Ana\n  No. 0001  Ben");
    expect(m.text).toContain("Still in the hat: 2 names, 4 tickets\n  Cy\n  Dee (3 tickets)");
    expect(m.text).toContain("Next draw: Fri, 20 Nov 2026, 09:00 GMT-7 (America/Denver).");
    expect(m.text).toContain("Raffle: https://hat.example/r/abc23456");
    expect(m.text).toContain("https://hat.example/r/abc23456/verify?round=3");
    expect(m.text).toContain("because you host");
  });

  it("escapes names and titles in the HTML", () => {
    const m = buildResultsEmail(
      { ...base, pulled: [{ label: "<script>x</script>", position: 0 }] },
      host,
    );
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(m.html).toContain("Office &lt;Lunch&gt; Draw");
    expect(m.html).toContain('href="https://hat.example/r/abc23456/verify?round=3"');
  });

  it("says eliminated, and left standing at the end", () => {
    const m = buildResultsEmail(
      {
        ...base,
        raffle: { ...base.raffle, mode: "eliminate", finished: true, nextDrawAt: null },
        pulled: [{ label: "Ana", position: 2 }],
        remaining: [{ label: "Cy", tickets: 1 }],
      },
      host,
    );
    expect(m.subject).toBe("Office <Lunch> Draw: round 3 results, final");
    expect(m.text).toContain("Eliminated:\n  No. 0003  Ana");
    expect(m.text).toContain("Left standing: 1 name\n  Cy");
    expect(m.text).toContain("That was the last round. The raffle is finished.");
    expect(m.text).not.toContain("Next draw");
  });

  it("keeps a single draw short", () => {
    const m = buildResultsEmail(
      {
        ...base,
        round: 1,
        raffle: { ...base.raffle, recurring: false, finished: true, nextDrawAt: null },
        pulled: [{ label: "Ana", position: 0 }],
      },
      host,
    );
    expect(m.subject).toBe("Office <Lunch> Draw: results");
    expect(m.text).toContain("The draw is done.");
    expect(m.text).toContain("Winner:\n  No. 0001  Ana");
    expect(m.text).not.toContain("in the hat");
    expect(m.text).toContain("The raffle is finished.");
    expect(m.text).toContain("verify?round=1");
  });

  it("says a manual raffle waits for the host", () => {
    const m = buildResultsEmail({ ...base, raffle: { ...base.raffle, nextDrawAt: null } }, host);
    expect(m.text).toContain("The next round starts when the host draws it.");
  });

  it("cuts a long hat down to a count", () => {
    const remaining = Array.from({ length: 40 }, (_, i) => ({ label: `N${i}`, tickets: 1 }));
    const m = buildResultsEmail({ ...base, remaining }, host);
    expect(m.text).toContain("Still in the hat: 40 names");
    expect(m.text).toContain(`N${REMAINING_SHOWN - 1}\n`);
    expect(m.text).not.toContain(`N${REMAINING_SHOWN}\n`);
    expect(m.text).toContain(`…and ${40 - REMAINING_SHOWN} more`);
  });

  it("explains why each recipient got it", () => {
    const added = buildResultsEmail(base, { email: "ana@x.io", reason: "added" });
    expect(added.text).toContain('Dana, who hosts "Office <Lunch> Draw", added ana@x.io');
    const member = buildResultsEmail(
      { ...base, orgName: "Acme" },
      { email: "cy@x.io", reason: "member" },
    );
    expect(member.text).toContain("you're a member of Acme");
  });

  it("keeps newlines out of the subject", () => {
    const m = buildResultsEmail(
      { ...base, raffle: { ...base.raffle, title: "A\r\nBcc: x" } },
      host,
    );
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("formatDrawTime", () => {
  it("shows UTC without repeating the zone", () => {
    expect(formatDrawTime(new Date("2026-01-02T03:04:00Z"), null)).toBe(
      "Fri, 2 Jan 2026, 03:04 UTC",
    );
  });
});

describe("sendOnce", () => {
  // The same compare-and-set the database does with
  // UPDATE draw SET results_emailed_at = now() WHERE id = $1 AND results_emailed_at IS NULL RETURNING id.
  function fakeDraw() {
    let emailedAt: number | null = null;
    return {
      claim: async () => {
        await Promise.resolve();
        if (emailedAt !== null) return false;
        emailedAt = Date.now();
        return true;
      },
    };
  }

  it("sends once however many callers race", async () => {
    const d = fakeDraw();
    let sends = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendOnce(d.claim, async () => void sends++)),
    );
    expect(sends).toBe(1);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(results.filter((r) => r === "skipped")).toHaveLength(4);
  });

  it("swallows and logs a failed send, and doesn't retry it", async () => {
    const d = fakeDraw();
    const logged: string[] = [];
    const log = (msg: string) => void logged.push(msg);
    const fail = async () => {
      throw new Error("Resend down");
    };
    expect(await sendOnce(d.claim, fail, log)).toBe("failed");
    expect(logged).toEqual(["result email: send failed"]);
    expect(await sendOnce(d.claim, fail, log)).toBe("skipped");
  });

  it("swallows a failed claim", async () => {
    const claim = async (): Promise<boolean> => {
      throw new Error("db down");
    };
    let sent = false;
    expect(
      await sendOnce(
        claim,
        async () => void (sent = true),
        () => {},
      ),
    ).toBe("failed");
    expect(sent).toBe(false);
  });
});
