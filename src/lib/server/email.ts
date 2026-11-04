import { EMAIL_FROM, RESEND_API_KEY } from "$app/env/private";

/** Sends the magic-link email via Resend, or logs the link when no key is set (local dev). */
export async function sendMagicLinkEmail(to: string, url: string) {
  if (!RESEND_API_KEY) {
    console.log(`\n[magic link] ${to}\n${url}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM ?? "VRF Hat <onboarding@resend.dev>",
      to,
      subject: "Your sign-in link for VRF Hat",
      text: `Sign in to VRF Hat:\n\n${url}\n\nThe link works once and expires in 5 minutes. If you didn't ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}
