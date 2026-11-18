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
