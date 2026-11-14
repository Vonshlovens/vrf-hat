import { error } from "@sveltejs/kit";
import { getRaffle, tick } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

/**
 * Polled by the raffle page while it waits for Chainlink, and once a
 * scheduled draw is due. Polling also moves the raffle along, so a draw
 * doesn't depend on the cron trigger alone.
 */
export const GET: RequestHandler = async ({ params }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  const now = await tick(raffle);
  return Response.json(
    { status: now.status, nextDrawAt: now.nextDrawAt?.toISOString() ?? null },
    { headers: { "cache-control": "no-store" } },
  );
};
