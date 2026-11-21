import { error } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { raffleKeyPreimage } from "#lib/draw/commitment.ts";
import { db } from "#lib/server/db/index.ts";
import { entry } from "#lib/server/db/schema.ts";
import { visibleRaffle } from "#lib/server/orgs.ts";
import { listDraws } from "#lib/server/raffles.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const raffle = await visibleRaffle(params.slug, locals.user?.id, {
    next: url.pathname + url.search,
  });
  const draws = await listDraws(raffle.id);
  const wanted = url.searchParams.get("round");
  const draw = wanted ? draws.find((d) => String(d.round) === wanted) : draws.at(-1);
  if (wanted && !draw) error(404, "No such round.");
  // The signed-in viewer's own entry, so the simple view can find their
  // tickets in the sealed list. Which entry is theirs is the app's word.
  const [mine] = locals.user
    ? await db
        .select({ label: entry.label, ticket: entry.ticket })
        .from(entry)
        .where(and(eq(entry.raffleId, raffle.id), eq(entry.userId, locals.user.id)))
    : [];
  return {
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      mode: raffle.mode,
      recurring: raffle.recurring,
      raffleId: raffle.id,
      private: Boolean(raffle.organizationId),
    },
    rounds: draws.map((d) => d.round),
    mine: mine ?? null,
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
