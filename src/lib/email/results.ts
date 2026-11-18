// The email sent after each round, and who it goes to. Pure, so it can be
// tested without a database or a mail service.

export type RecipientReason = "host" | "added" | "member";
export type Recipient = { email: string; reason: RecipientReason };

export type RoundResult = {
  /** e.g. "https://vrf-hat.example"; no trailing slash needed. */
  origin: string;
  raffle: {
    slug: string;
    title: string;
    mode: "win" | "eliminate";
    recurring: boolean;
    /** True once no more rounds will be drawn. */
    finished: boolean;
    /** IANA zone; UTC when unset. */
    timezone: string | null;
    nextDrawAt: Date | null;
  };
  round: number;
  hostName: string;
  orgName: string | null;
  /**
   * Tickets this round pulled, in the order they came out. `position` is
   * 0-based; `id` is the entry's, when known (labels can repeat).
   */
  pulled: { label: string; position: number; id?: string | null }[];
  /** Names still holding tickets after the round. */
  remaining: { label: string; tickets: number; id?: string | null }[];
};

export type Message = { to: string; subject: string; text: string; html: string };

/** Most extra addresses a host can add to one raffle. */
export const MAX_RECIPIENTS = 50;
/** Names listed under "still in the hat" before it turns into a count. */
export const REMAINING_SHOWN = 25;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** A trimmed, lowercased address, or null if it doesn't look like one. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

/**
 * Everyone who gets the email, each once. Someone who is both host and an
 * added address is told they get it as the host; added beats member.
 */
export function mergeRecipients(lists: {
  host: string | null;
  added: string[];
  members: string[];
}): Recipient[] {
  const seen = new Map<string, Recipient>();
  const put = (raw: string | null, reason: RecipientReason) => {
    const email = raw && normalizeEmail(raw);
    if (email && !seen.has(email)) seen.set(email, { email, reason });
  };
  put(lists.host, "host");
  for (const e of lists.added) put(e, "added");
  for (const e of lists.members) put(e, "member");
  return [...seen.values()];
}

const pad = (n: number) => String(n).padStart(4, "0");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** "Fri, 20 Nov 2026, 09:00 GMT-7 (America/Denver)". */
export function formatDrawTime(at: Date, timezone: string | null): string {
  const tz = timezone ?? "UTC";
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
  return tz === "UTC" ? when : `${when} (${tz})`;
}

export function raffleUrl(origin: string, slug: string) {
  return `${origin.replace(/\/+$/, "")}/r/${slug}`;
}

export function verifyUrl(origin: string, slug: string, round: number) {
  return `${raffleUrl(origin, slug)}/verify?round=${round}`;
}

function whyLine(r: RoundResult, to: Recipient): string {
  const title = `"${oneLine(r.raffle.title)}"`;
  switch (to.reason) {
    case "host":
      return `You're getting this because you host ${title}. You can turn these emails off on the raffle page.`;
    case "added":
      return `You're getting this because ${r.hostName}, who hosts ${title}, added ${to.email} to its result emails. To stop them, ask ${r.hostName} to remove you.`;
    case "member":
      return `You're getting this because you're a member of ${r.orgName ?? "the organization"} and ${r.hostName}, who hosts ${title}, chose to email its members the results.`;
  }
}

/**
 * An elimination round's pulled tickets, one line per name in the order each
 * name first came out: how many it lost, which numbers, and what it has left.
 */
function byName(r: RoundResult) {
  const keyOf = (e: { label: string; id?: string | null }) => e.id ?? `label:${e.label}`;
  const left = new Map(r.remaining.map((e) => [keyOf(e), e.tickets]));
  const groups = new Map<string, { label: string; numbers: string[] }>();
  for (const p of r.pulled) {
    const g = groups.get(keyOf(p)) ?? { label: p.label, numbers: [] };
    g.numbers.push(pad(p.position + 1));
    groups.set(keyOf(p), g);
  }
  return [...groups].map(([key, g]) => {
    const remaining = left.get(key) ?? 0;
    return {
      label: g.label,
      number: g.numbers.join(", "),
      lost: g.numbers.length,
      note: remaining > 0 ? `${remaining} left` : "out",
    };
  });
}

/** The facts shared by both versions of the email. */
function content(r: RoundResult) {
  const eliminate = r.raffle.mode === "eliminate";
  const title = oneLine(r.raffle.title);
  const drawnLine = r.raffle.recurring ? `Round ${r.round} has been drawn.` : "The draw is done.";
  const pickedHeading = eliminate
    ? `Tickets pulled (${r.pulled.length})`
    : r.pulled.length === 1
      ? "Winner"
      : "Winners";
  const picked = eliminate
    ? byName(r)
    : r.pulled.map((p) => ({
        label: p.label,
        number: pad(p.position + 1),
        lost: undefined as number | undefined,
        note: "",
      }));
  // An elimination round can pull tickets without putting anyone out: a name
  // is out only once its last ticket is pulled.
  const out = eliminate ? picked.filter((p) => p.note === "out").map((p) => p.label) : null;

  // A single win draw has nothing more to come, so who else was in doesn't matter.
  const showRemaining = r.raffle.recurring || eliminate;
  const remainingHeading = r.raffle.finished
    ? eliminate
      ? "Left standing"
      : "Left in the hat"
    : "Still in the hat";
  const tickets = r.remaining.reduce((sum, e) => sum + e.tickets, 0);
  const remainingSummary =
    r.remaining.length === tickets
      ? plural(r.remaining.length, "name")
      : `${plural(r.remaining.length, "name")}, ${plural(tickets, "ticket")}`;
  const shown = r.remaining.slice(0, REMAINING_SHOWN).map((e) => ({
    label: e.label,
    extra: e.tickets > 1 ? ` (${e.tickets} tickets)` : "",
  }));
  const more = r.remaining.length - shown.length;

  let status: string;
  if (r.raffle.finished) {
    status = r.raffle.recurring
      ? "That was the last round. The raffle is finished."
      : "The raffle is finished.";
  } else if (r.raffle.nextDrawAt) {
    status = `Next draw: ${formatDrawTime(r.raffle.nextDrawAt, r.raffle.timezone)}.`;
  } else {
    status = "The next round starts when the host draws it.";
  }

  const outText = out ? (out.length ? `${plural(out.length, "name")} out` : "nobody out") : "";
  const subject = oneLine(
    r.raffle.recurring
      ? `${title}: round ${r.round} ${r.raffle.finished ? "results, final" : "results"}${outText ? ` (${outText})` : ""}`
      : `${title}: results`,
  );

  return {
    subject,
    title,
    drawnLine,
    pickedHeading,
    picked,
    out,
    showRemaining,
    remainingHeading,
    remainingSummary,
    shown,
    more,
    status,
    raffleLink: raffleUrl(r.origin, r.raffle.slug),
    verifyLink: verifyUrl(r.origin, r.raffle.slug, r.round),
  };
}

function plainText(r: RoundResult, to: Recipient): string {
  const c = content(r);
  const lines = [`${c.title}`, c.drawnLine, ""];
  if (c.out) {
    if (c.out.length) {
      lines.push("Out this round:");
      for (const label of c.out) lines.push(`  ${label}`);
    } else {
      lines.push("Nobody is out this round: every name that lost a ticket still has one left.");
    }
    lines.push("");
  }
  lines.push(`${c.pickedHeading}:`);
  for (const p of c.picked) lines.push(`  ${pickedLine(p)}`);
  if (c.picked.length === 0) lines.push("  (none)");
  if (c.showRemaining) {
    lines.push("", `${c.remainingHeading}: ${c.remainingSummary}`);
    for (const e of c.shown) lines.push(`  ${e.label}${e.extra}`);
    if (c.more > 0) lines.push(`  …and ${c.more} more`);
  }
  lines.push(
    "",
    c.status,
    "",
    `Raffle: ${c.raffleLink}`,
    `Check this ${r.raffle.recurring ? "round" : "draw"} yourself: ${c.verifyLink}`,
    "",
    "--",
    whyLine(r, to),
  );
  return lines.join("\n");
}

/** "No. 0007  Ana", or for an elimination "Team 10: 2 (No. 0034, 0030), 14 left". */
function pickedLine(p: { label: string; number: string; note: string; lost?: number }) {
  if (p.lost === undefined) return `No. ${p.number}  ${p.label}`;
  return `${p.label}: ${p.lost} (No. ${p.number}), ${p.note}`;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

function htmlBody(r: RoundResult, to: Recipient): string {
  const c = content(r);
  const muted = "color:#6b6b6b";
  const mono = "font-family:ui-monospace,Menlo,Consolas,monospace";
  const list = (items: string[]) =>
    `<ul style="margin:0 0 16px;padding-left:20px">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  const picked = c.picked.length
    ? list(
        c.picked.map((p) =>
          p.lost !== undefined
            ? `${esc(p.label)}: ${p.lost} <span style="${mono};${muted}">(No.&nbsp;${esc(p.number)})</span>, ${p.note === "out" ? "<strong>out</strong>" : esc(p.note)}`
            : `<span style="${mono};${muted}">No.&nbsp;${p.number}</span> ${esc(p.label)}`,
        ),
      )
    : `<p style="${muted}">(none)</p>`;
  let out = "";
  if (c.out) {
    out = c.out.length
      ? `<h2 style="font-size:15px;margin:16px 0 8px">Out this round</h2>${list(c.out.map((l) => `<strong>${esc(l)}</strong>`))}`
      : `<p style="margin:16px 0"><strong>Nobody is out this round:</strong> every name that lost a ticket still has one left.</p>`;
  }
  let remaining = "";
  if (c.showRemaining) {
    const items = c.shown.map((e) => `${esc(e.label)}${esc(e.extra)}`);
    if (c.more > 0) items.push(`<span style="${muted}">…and ${c.more} more</span>`);
    remaining = `<h2 style="font-size:15px;margin:16px 0 8px">${esc(c.remainingHeading)}: ${esc(c.remainingSummary)}</h2>${items.length ? list(items) : ""}`;
  }
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:560px">
<h1 style="font-size:20px;margin:0 0 4px">${esc(c.title)}</h1>
<p style="margin:0 0 16px;${muted}">${esc(c.drawnLine)}</p>
${out}<h2 style="font-size:15px;margin:16px 0 8px">${esc(c.pickedHeading)}</h2>
${picked}${remaining}
<p style="margin:16px 0">${esc(c.status)}</p>
<p style="margin:16px 0"><a href="${esc(c.raffleLink)}">Open the raffle</a> &middot; <a href="${esc(c.verifyLink)}">Check this ${r.raffle.recurring ? "round" : "draw"} yourself</a></p>
<hr style="border:0;border-top:1px solid #e0e0e0;margin:24px 0 12px">
<p style="margin:0;font-size:13px;${muted}">${esc(whyLine(r, to))}</p>
</div>
</body></html>`;
}

/** One email for one recipient. */
export function buildResultsEmail(r: RoundResult, to: Recipient): Message {
  return {
    to: to.email,
    subject: content(r).subject,
    text: plainText(r, to),
    html: htmlBody(r, to),
  };
}

/**
 * Runs `send` only if `claim` wins. `claim` must be an atomic test-and-set in
 * shared storage (an UPDATE ... WHERE results_emailed_at IS NULL RETURNING),
 * so concurrent callers can't both get true. Claiming first means a crash
 * after the claim loses the email rather than sending it twice; a failed send
 * is logged and swallowed so it never breaks the draw.
 */
export async function sendOnce(
  claim: () => Promise<boolean>,
  send: () => Promise<void>,
  log: (msg: string, err: unknown) => void = console.error,
): Promise<"sent" | "skipped" | "failed"> {
  try {
    if (!(await claim())) return "skipped";
  } catch (err) {
    log("result email: claim failed", err);
    return "failed";
  }
  try {
    await send();
    return "sent";
  } catch (err) {
    log("result email: send failed", err);
    return "failed";
  }
}
