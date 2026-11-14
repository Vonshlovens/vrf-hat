// Runs after `vp build`. adapter-cloudflare writes a Worker that only handles
// requests, to the path wrangler.jsonc calls `main`. Scheduled draws need a
// cron handler as well, so this moves the adapter's Worker aside and makes
// `main` re-export cloudflare/worker.js, which wraps it.
import { appendFile, rename, writeFile } from "node:fs/promises";

const dir = ".svelte-kit/cloudflare";
await rename(`${dir}/_worker.js`, `${dir}/_app.js`);
// The directory is also served as static assets; keep the server code out of it.
await appendFile(`${dir}/.assetsignore`, "\n_app.js\n");
await writeFile(`${dir}/_worker.js`, 'export { default } from "../../cloudflare/worker.js";\n');
console.log("Wrapped the Worker with the cron handler (cloudflare/worker.js).");
