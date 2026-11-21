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

  it("says who is out, and left standing at the end", () => {
    const m = buildResultsEmail(
      {
        ...base,
        raffle: { ...base.raffle, mode: "eliminate", finished: true, nextDrawAt: null },
        pulled: [{ label: "Ana", position: 2 }],
        remaining: [{ label: "Cy", tickets: 1 }],
      },
      host,
    );
    expect(m.subject).toBe("Office <Lunch> Draw: round 3 results, final (1 name out)");
    expect(m.text).toContain("Out this round:\n  Ana\n");
    expect(m.text).toContain("Tickets pulled (1):\n  Ana: 1 (No. 0003), out");
    expect(m.text).toContain("Left standing: 1 name\n  Cy");
    expect(m.text).toContain("That was the last round. The raffle is finished.");
    expect(m.text).not.toContain("Next draw");
  });

  it("tells extra lives apart from names going out", () => {
    const m = buildResultsEmail(
      {
        ...base,
        raffle: { ...base.raffle, mode: "eliminate" },
        pulled: [
          { label: "Team 10", position: 33, id: "a" },
          { label: "Team 20", position: 90, id: "b" },
          { label: "Team 10", position: 29, id: "a" },
        ],
        remaining: [
          { label: "Team 10", tickets: 14, id: "a" },
          { label: "Team 01", tickets: 4, id: "c" },
        ],
      },
      host,
    );
    expect(m.subject).toBe("Office <Lunch> Draw: round 3 results (1 name out)");
    expect(m.text).toContain("Out this round:\n  Team 20\n");
    expect(m.text).toContain(
      "Tickets pulled (3):\n  Team 10: 2 (No. 0034, 0030), 14 left\n  Team 20: 1 (No. 0091), out",
    );
    expect(m.html).toContain("<strong>Team 20</strong>");
  });

  it("puts an elimination round's pulled tickets in a table", () => {
    const m = buildResultsEmail(
      {
        ...base,
        raffle: { ...base.raffle, mode: "eliminate" },
        pulled: [
          { label: "Team <10>", position: 33, id: "a" },
          { label: "Team 20", position: 90, id: "b" },
          { label: "Team <10>", position: 29, id: "a" },
        ],
        remaining: [
          { label: "Team <10>", tickets: 14, id: "a" },
          { label: "Team 01", tickets: 4, id: "c" },
        ],
      },
      host,
    );
    const cells = (html: string) =>
      [...html.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map((x) => x[1]!.replace(/<[^>]+>/g, ""));
    const [picked, remaining] = m.html.split("<table").slice(1);
    expect(m.html).not.toMatch(/<style|display:\s*(flex|grid)/);
    expect(picked).toContain("border-collapse:collapse");
    expect(cells(picked!)).toEqual([
      "Name",
      "Tickets pulled",
      "Ticket numbers",
      "Left",
      "Team &lt;10&gt;",
      "2",
      "No.&nbsp;0034, No.&nbsp;0030",
      "14",
      "Team 20",
      "1",
      "No.&nbsp;0091",
      "out",
    ]);
    expect(picked).toContain('<strong style="color:#b42318">out</strong>');
    expect(cells(remaining!)).toEqual([
      "Name",
      "Tickets left",
      "Team &lt;10&gt;",
      "14",
      "Team 01",
      "4",
    ]);
    // The lead above the table stays a sentence/list.
    expect(m.html).toContain("Out this round</h2>");
  });

  it("puts winners in a table", () => {
    const m = buildResultsEmail(base, host);
    expect(m.html).toMatch(
      /<th scope="col"[^>]*>Name<\/th><th scope="col"[^>]*>Ticket numbers<\/th>/,
    );
    expect(m.html).toContain("<strong>Ana</strong>");
    expect(m.html).toContain("No.&nbsp;0007");
    expect(m.html).toMatch(/<th scope="col"[^>]*>Tickets left<\/th>/);
  });

  it("ends a long hat's table with a count", () => {
    const remaining = Array.from({ length: 40 }, (_, i) => ({ label: `N${i}`, tickets: 1 }));
    const m = buildResultsEmail({ ...base, remaining }, host);
    expect(m.html).toContain(`<td colspan="2"`);
    expect(m.html).toContain(`…and ${40 - REMAINING_SHOWN} more</td>`);
    expect(m.html).not.toContain(`>N${REMAINING_SHOWN}<`);
  });

  it("says when nobody is out yet", () => {
    const m = buildResultsEmail(
      {
        ...base,
        raffle: { ...base.raffle, mode: "eliminate" },
        pulled: [{ label: "Team 10", position: 0, id: "a" }],
        remaining: [{ label: "Team 10", tickets: 15, id: "a" }],
      },
      host,
    );
    expect(m.subject).toBe("Office <Lunch> Draw: round 3 results (nobody out)");
    expect(m.text).toContain("Nobody is out this round");
    expect(m.text).not.toContain("Out this round");
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
