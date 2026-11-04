import { error } from "@sveltejs/kit";
import { getRaffle, syncDraw } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

/** Polled by the raffle page while waiting for Chainlink. */
export const GET: RequestHandler = async ({ params }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  const synced = await syncDraw(raffle);
  return Response.json({ status: synced.status }, { headers: { "cache-control": "no-store" } });
};
