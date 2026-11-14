import { error } from "@sveltejs/kit";
import { raffleKeyPreimage } from "#lib/draw/commitment.ts";
import { getRaffle, listDraws } from "#lib/server/raffles.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  const draws = await listDraws(raffle.id);
  const wanted = url.searchParams.get("round");
  const draw = wanted ? draws.find((d) => String(d.round) === wanted) : draws.at(-1);
  if (wanted && !draw) error(404, "No such round.");
  return {
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      mode: raffle.mode,
      recurring: raffle.recurring,
      raffleId: raffle.id,
    },
    rounds: draws.map((d) => d.round),
    draw: draw
      ? {
          round: draw.round,
          chainId: draw.chainId,
          contract: draw.contractAddress as `0x${string}`,
          raffleKey: draw.raffleKey as `0x${string}`,
          keyText: raffleKeyPreimage(raffle.id, draw.round, raffle.mode),
        }
      : null,
  };
};
