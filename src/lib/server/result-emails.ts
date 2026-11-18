// Emails the host (and whoever they chose) after each round is drawn.
// raffles.ts calls afterRoundDrawn once a round's result is recorded; the rest
// is here: the recipient list, the send-once claim, and the send itself.
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getRequestEvent } from "$app/server";
import { ORIGIN } from "$app/env/private";
import { removesPicked } from "#lib/draw/rounds.ts";
import {
  buildResultsEmail,
  MAX_RECIPIENTS,
  mergeRecipients,
  normalizeEmail,
  sendOnce,
} from "#lib/email/results.ts";
import { db } from "./db/index.ts";
import {
  draw,
  drawSlot,
  entry,
  member,
  organization,
  raffle,
  resultEmailSettings,
  resultRecipient,
  user,
  type Raffle,
} from "./db/schema.ts";
import { sendBatch } from "./email.ts";

export class RecipientError extends Error {}

export type EmailOptions = { emailHost: boolean; emailMembers: boolean };

const DEFAULTS: EmailOptions = { emailHost: true, emailMembers: false };

export async function emailOptions(raffleId: string): Promise<EmailOptions> {
  const [row] = await db
    .select({
      emailHost: resultEmailSettings.emailHost,
      emailMembers: resultEmailSettings.emailMembers,
    })
    .from(resultEmailSettings)
    .where(eq(resultEmailSettings.raffleId, raffleId));
  return row ?? DEFAULTS;
}

export async function setEmailOptions(r: Raffle, options: EmailOptions) {
  const value = {
    emailHost: options.emailHost,
    emailMembers: Boolean(r.organizationId) && options.emailMembers,
  };
  await db
    .insert(resultEmailSettings)
    .values({ raffleId: r.id, ...value })
    .onConflictDoUpdate({ target: resultEmailSettings.raffleId, set: value });
}

export async function listRecipients(raffleId: string) {
  const rows = await db
    .select({ email: resultRecipient.email })
    .from(resultRecipient)
    .where(eq(resultRecipient.raffleId, raffleId))
    .orderBy(asc(resultRecipient.createdAt), asc(resultRecipient.email));
  return rows.map((r) => r.email);
}

/** Addresses separated by commas, semicolons, spaces or new lines. */
export async function addRecipients(r: Raffle, addedBy: string, raw: string) {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) throw new RecipientError("Enter an email address.");
  const bad = parts.find((p) => !normalizeEmail(p));
  if (bad) throw new RecipientError(`"${bad.slice(0, 80)}" isn't an email address.`);
  const wanted = [...new Set(parts.map((p) => normalizeEmail(p)!))];

  const have = new Set(await listRecipients(r.id));
  const fresh = wanted.filter((e) => !have.has(e));
  if (have.size + fresh.length > MAX_RECIPIENTS) {
    throw new RecipientError(`A raffle can email at most ${MAX_RECIPIENTS} extra addresses.`);
  }
  if (fresh.length === 0) return 0;
  // The cap is checked again in the insert itself, so two tabs can't both squeeze in.
  const values = sql.join(
    fresh.map((e) => sql`(${e})`),
    sql`, `,
  );
  const inserted = await db.execute<{ email: string }>(sql`
    insert into ${resultRecipient} (raffle_id, email, added_by)
    select ${r.id}::uuid, v.email, ${addedBy}
    from (values ${values}) as v(email)
    where (select count(*) from ${resultRecipient} where raffle_id = ${r.id}::uuid)
          + ${fresh.length}::int <= ${MAX_RECIPIENTS}::int
    on conflict do nothing
    returning email`);
  if (inserted.rows.length === 0) {
    throw new RecipientError(`A raffle can email at most ${MAX_RECIPIENTS} extra addresses.`);
  }
  return inserted.rows.length;
}

export async function removeRecipient(r: Raffle, raw: string) {
  const email = normalizeEmail(raw);
  if (!email) return;
  await db
    .delete(resultRecipient)
    .where(and(eq(resultRecipient.raffleId, r.id), eq(resultRecipient.email, email)));
}

async function memberEmails(organizationId: string) {
  const rows = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));
  return rows.map((r) => r.email);
}

/** What the host sees in the "Result emails" section. Never send this to anyone else. */
export async function hostEmailSettings(r: Raffle) {
  const [options, recipients, members] = await Promise.all([
    emailOptions(r.id),
    listRecipients(r.id),
    r.organizationId
      ? db
          .select({ n: count() })
          .from(member)
          .where(eq(member.organizationId, r.organizationId))
          .then(([row]) => row.n)
      : null,
  ]);
  return { ...options, recipients, memberCount: members, max: MAX_RECIPIENTS };
}

// -------------------------------------------------------------------- send

/** Atomically marks the round's email as sent. Only one caller ever gets true. */
async function claimRound(drawId: string) {
  const rows = await db
    .update(draw)
    .set({ resultsEmailedAt: new Date() })
    .where(and(eq(draw.id, drawId), isNotNull(draw.randomWord), isNull(draw.resultsEmailedAt)))
    .returning({ id: draw.id });
  return rows.length > 0;
}

async function deliver(drawId: string) {
  const [row] = await db
    .select({
      draw,
      raffle,
      hostName: user.name,
      hostEmail: user.email,
      orgName: organization.name,
    })
    .from(draw)
    .innerJoin(raffle, eq(raffle.id, draw.raffleId))
    .innerJoin(user, eq(user.id, raffle.hostId))
    .leftJoin(organization, eq(organization.id, raffle.organizationId))
    .where(eq(draw.id, drawId));
  if (!row) return;
  const r = row.raffle;

  const [options, added, members, pulled, entries] = await Promise.all([
    emailOptions(r.id),
    listRecipients(r.id),
    r.organizationId ? memberEmails(r.organizationId) : [],
    db
      .select({ label: drawSlot.label, position: drawSlot.position, id: drawSlot.entryId })
      .from(drawSlot)
      .where(and(eq(drawSlot.drawId, drawId), isNotNull(drawSlot.pickedRank)))
      .orderBy(asc(drawSlot.pickedRank)),
    db
      .select({ id: entry.id, label: entry.label, count: entry.count, picked: entry.picked })
      .from(entry)
      .where(eq(entry.raffleId, r.id))
      .orderBy(asc(entry.createdAt), asc(entry.id)),
  ]);

  const recipients = mergeRecipients({
    host: options.emailHost ? row.hostEmail : null,
    added,
    // A host who turned "Email me" off isn't emailed as a member either.
    members: options.emailMembers
      ? members.filter((e) => e.toLowerCase() !== row.hostEmail.toLowerCase())
      : [],
  });
  if (recipients.length === 0) return;

  const removes = removesPicked(r);
  const result = {
    origin: ORIGIN,
    raffle: {
      slug: r.slug,
      title: r.title,
      mode: r.mode,
      recurring: r.recurring,
      finished: r.status === "drawn",
      timezone: r.timezone,
      nextDrawAt: r.status === "drawn" ? null : r.nextDrawAt,
    },
    round: row.draw.round,
    hostName: row.hostName || row.hostEmail,
    orgName: row.orgName,
    pulled,
    remaining: entries
      .map((e) => ({
        id: e.id,
        label: e.label,
        tickets: removes ? Math.max(0, e.count - e.picked) : e.count,
      }))
      .filter((e) => e.tickets > 0),
  };
  await sendBatch(recipients.map((to) => buildResultsEmail(result, to)));
  console.log(
    `result email: raffle ${r.slug} round ${row.draw.round} sent to ${recipients.length}`,
  );
}

/** Sends a drawn round's result email, unless some other call already has. Never throws. */
export function emailRoundResults(drawId: string) {
  return sendOnce(
    () => claimRound(drawId),
    () => deliver(drawId),
  );
}

type WaitUntil = (promise: Promise<unknown>) => void;

function requestWaitUntil(): WaitUntil | null {
  try {
    const platform = getRequestEvent().platform as { ctx?: { waitUntil?: WaitUntil } } | undefined;
    const ctx = platform?.ctx;
    return ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : null;
  } catch {
    // Not inside a request (a script, a test).
    return null;
  }
}

/**
 * Called once a round's random word is recorded and the raffle reopened or
 * finished. On Cloudflare the email goes out after the response via the
 * request's waitUntil (for the cron that is the scheduled event's context),
 * so neither the page poll nor the cron loop waits on Resend. Elsewhere it is
 * awaited, bounded by the send timeout. Either way it never throws.
 */
export async function afterRoundDrawn(drawId: string) {
  const sending = emailRoundResults(drawId);
  const waitUntil = requestWaitUntil();
  if (waitUntil) waitUntil(sending);
  else await sending;
}
