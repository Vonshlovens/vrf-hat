// The token the Worker's cron handler presents to POST /cron. Derived from
// the session secret so there is no extra secret to configure. Plain JS: the
// Worker entry (cloudflare/worker.js) imports it outside the SvelteKit build.

/** @param {string} secret */
export async function cronToken(secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode("vrf-hat:cron"));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}
