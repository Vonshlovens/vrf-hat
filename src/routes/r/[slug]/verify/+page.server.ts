import { error } from "@sveltejs/kit";
import { getRaffle } from "#lib/server/raffles.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const raffle = await getRaffle(params.slug);
  if (!raffle) error(404, "No raffle at this address.");
  return {
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      status: raffle.status,
      chainId: raffle.chainId,
      contract: raffle.contractAddress as `0x${string}` | null,
      raffleKey: raffle.raffleKey as `0x${string}` | null,
      raffleId: raffle.id,
    },
  };
};
