import { EMAIL_FROM, RESEND_API_KEY } from "$app/env/private";

/** Sends a plain-text email via Resend, or logs it when no key is set (local dev). */
async function send(to: string, subject: string, text: string) {
  if (!RESEND_API_KEY) {
    console.log(`\n[email] ${to}: ${subject}\n${text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM ?? "VRF Hat <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}

export function sendMagicLinkEmail(to: string, url: string) {
  return send(
    to,
    "Your sign-in link for VRF Hat",
    `Sign in to VRF Hat:\n\n${url}\n\nThe link works once and expires in 5 minutes. If you didn't ask for it, ignore this email.`,
  );
}

export function sendInvitationEmail(
  to: string,
  invite: { orgName: string; inviterName: string; url: string },
) {
  return send(
    to,
    `Join ${invite.orgName} on VRF Hat`,
    `${invite.inviterName} invited you to ${invite.orgName} on VRF Hat. Members can see and enter its raffles.\n\n${invite.url}\n\nSign in with this email address (${to}) to accept. The invitation expires in 7 days. If you weren't expecting it, ignore this email.`,
  );
}

type BatchMessage = { to: string; subject: string; text: string; html?: string };

/**
 * Sends many emails, each to one address, through Resend's batch endpoint
 * (up to 100 per call, so a big list costs few subrequests). Logs them
 * instead when no key is set. Gives up on a call after `timeoutMs`.
 */
export async function sendBatch(messages: BatchMessage[], timeoutMs = 10_000) {
  if (!RESEND_API_KEY) {
    for (const m of messages) console.log(`\n[email] ${m.to}: ${m.subject}\n${m.text}\n`);
    return;
  }
  const from = EMAIL_FROM ?? "VRF Hat <onboarding@resend.dev>";
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100).map((m) => ({ from, ...m }))),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
  }
}
