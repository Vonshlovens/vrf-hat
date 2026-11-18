import { error } from "@sveltejs/kit";
import { visibleRaffle } from "#lib/server/orgs.ts";
import { committedList, listDraws } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

/**
 * A round's committed list, published so anyone can rebuild the Merkle root.
 * `?round=N` picks the round; the default is the latest. A name holding
 * several tickets appears once per ticket.
 * An organization's raffle answers only its members (by session cookie),
 * and 404s for everyone else.
 * Format: { raffleId, round, mode, raffleKey, chainId, contract, root, pickCount,
 *           entrants: [{ index, ticket, label }] }
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
  const raffle = await visibleRaffle(params.slug, locals.user?.id);
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
    {
      headers: {
        "cache-control": raffle.organizationId ? "private, no-store" : "public, max-age=60",
      },
    },
  );
};
