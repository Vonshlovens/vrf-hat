// Runs the verify page's checks from the command line:
//   node scripts/verify-draw.ts <origin> <slug> [rpcUrl]
import { verifyDraw } from "#lib/verify/run.ts";

const [origin, slug, rpcUrl] = process.argv.slice(2);
if (!origin || !slug)
  throw new Error("usage: node scripts/verify-draw.ts <origin> <slug> [rpcUrl]");
const meta = await (await fetch(`${origin}/r/${slug}/entrants.json`)).json();
const result = await verifyDraw(
  {
    chainId: meta.chainId,
    contract: meta.contract,
    raffleKey: meta.raffleKey,
    rpcUrl,
    entrantsUrl: `${origin}/r/${slug}/entrants.json`,
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
