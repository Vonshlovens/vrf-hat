// The deployed Worker: SvelteKit's request handler plus a cron handler.
// adapter-cloudflare only emits `fetch`, so scripts/wrap-worker.ts puts this
// file in front of the adapter's output after every build. A cron run is
// handed to the app as a signed POST /cron, without leaving the Worker.
import app from "../.svelte-kit/cloudflare/_app.js";
import { cronToken } from "../src/lib/cron-token.js";

export default {
  fetch: app.fetch,

  /** Runs on the `triggers.crons` schedule in wrangler.jsonc. */
  async scheduled(_controller, env, ctx) {
    const token = await cronToken(env.BETTER_AUTH_SECRET);
    const res = await app.fetch(
      new Request(new URL("/cron", env.ORIGIN), {
        method: "POST",
        // A JSON body type keeps SvelteKit from treating this as a cross-site form post.
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      }),
      env,
      ctx,
    );
    const body = await res.text();
    if (!res.ok) throw new Error(`cron: ${res.status} ${body}`);
    console.log("cron", body);
  },
};
