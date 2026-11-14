// Runs the verify page's checks from the command line:
//   node scripts/verify-draw.ts <origin> <slug> [rpcUrl] [round]
// Without a round, checks the latest one.
import { raffleKeyPreimage } from "#lib/draw/commitment.ts";
import { verifyDraw } from "#lib/verify/run.ts";

const [origin, slug, rpcUrl, round] = process.argv.slice(2);
if (!origin || !slug)
  throw new Error("usage: node scripts/verify-draw.ts <origin> <slug> [rpcUrl] [round]");
const entrantsUrl = `${origin}/r/${slug}/entrants.json${round ? `?round=${round}` : ""}`;
const res = await fetch(entrantsUrl);
if (!res.ok) throw new Error(`${entrantsUrl}: ${res.status} ${await res.text()}`);
const meta = await res.json();
console.log(`round ${meta.round} (${meta.mode})`);
const result = await verifyDraw(
  {
    chainId: meta.chainId,
    contract: meta.contract,
    raffleKey: meta.raffleKey,
    rpcUrl: rpcUrl || undefined,
    entrantsUrl,
    mode: meta.mode,
    keyText: raffleKeyPreimage(meta.raffleId, meta.round, meta.mode),
  },
  () => {},
);
for (const step of result.steps) {
  console.log(`\n[${step.status}] ${step.title}`);
  for (const c of step.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label}`);
  if (step.note) console.log(`  note: ${step.note}`);
}
for (const s of result.shuffle) console.log(`  step ${s.step}: j=${s.j} -> ${s.label}`);
if (result.error) console.log("\nerror:", result.error);
process.exitCode = result.error || result.steps.some((s) => s.status === "fail") ? 1 : 0;
