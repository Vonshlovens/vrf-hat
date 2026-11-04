import { error } from "@sveltejs/kit";
import { getRaffle, listEntries, toCommitted } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

/**
 * The committed entrant list, published so anyone can rebuild the Merkle root.
 * Format: { raffleId, raffleKey, chainId, contract, root, entrants: [{ index, ticket, label }] }
 */
export const GET: RequestHandler = async ({ params }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  if (raffle.status === "open")
    error(409, "Entries are still open; the list is published when the draw starts.");
  const entrants = toCommitted(await listEntries(raffle.id));
  return Response.json(
    {
      raffleId: raffle.id,
      raffleKey: raffle.raffleKey,
      chainId: raffle.chainId,
      contract: raffle.contractAddress,
      root: raffle.entrantsRoot,
      winnerCount: raffle.winnerCount,
      entrants,
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
};
