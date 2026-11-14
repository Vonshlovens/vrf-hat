import { error } from "@sveltejs/kit";
import { committedList, getRaffle, listDraws } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

/**
 * A round's committed list, published so anyone can rebuild the Merkle root.
 * `?round=N` picks the round; the default is the latest. A name holding
 * several tickets appears once per ticket.
 * Format: { raffleId, round, mode, raffleKey, chainId, contract, root, pickCount,
 *           entrants: [{ index, ticket, label }] }
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  const draws = await listDraws(raffle.id);
  const wanted = url.searchParams.get("round");
  const draw = wanted ? draws.find((d) => String(d.round) === wanted) : draws.at(-1);
  if (!draw) {
    if (wanted && draws.length > 0) error(404, "No such round.");
    error(409, "Nothing has been drawn yet; a list is published when its draw starts.");
  }
  return Response.json(
    {
      raffleId: raffle.id,
      round: draw.round,
      mode: raffle.mode,
      raffleKey: draw.raffleKey,
      chainId: draw.chainId,
      contract: draw.contractAddress,
      root: draw.entrantsRoot,
      pickCount: draw.pickCount,
      // The contract's name for pickCount, whatever the picks mean.
      winnerCount: draw.pickCount,
      entrants: await committedList(draw.id),
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
};
