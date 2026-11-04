// `wrangler types --include-runtime=false` emits only the Env bindings, so the
// workerd runtime globals they reference must be declared here. Pulling in the
// full runtime types conflicts with the DOM lib that SvelteKit already loads.
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
