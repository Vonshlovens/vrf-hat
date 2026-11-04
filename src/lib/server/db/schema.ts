import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.schema.ts";

export * from "./auth.schema.ts";

/**
 * open      – taking entries
 * requested – entrant list committed on-chain, waiting for Chainlink VRF
 * drawn     – random word delivered; winners are fixed
 */
export const raffleStatus = pgEnum("raffle_status", ["open", "requested", "drawn"]);

export const raffle = pgTable(
  "raffle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    winnerCount: integer("winner_count").notNull().default(1),
    /** Whether signed-in people can add themselves, or only the host adds names. */
    selfEntry: boolean("self_entry").notNull().default(true),
    status: raffleStatus("status").notNull().default("open"),

    // Set when the draw is requested.
    chainId: integer("chain_id"),
    contractAddress: text("contract_address"),
    raffleKey: text("raffle_key"),
    entrantsRoot: text("entrants_root"),
    entrantCount: integer("entrant_count"),
    requestTx: text("request_tx"),
    requestId: text("request_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),

    // Set when VRF answers.
    randomWord: text("random_word"),
    drawnAt: timestamp("drawn_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("raffle_host_idx").on(t.hostId),
    check("raffle_winner_count_positive", sql`${t.winnerCount} > 0`),
  ],
);

export const entry = pgTable(
  "entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id")
      .notNull()
      .references(() => raffle.id, { onDelete: "cascade" }),
    /** Null for names the host typed in. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    /** Random 16-byte ticket, hex. Part of the committed leaf. */
    ticket: text("ticket").notNull(),
    /** Position in the committed list; assigned when the draw is requested. */
    position: integer("position"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entry_raffle_idx").on(t.raffleId),
    uniqueIndex("entry_raffle_user_uniq").on(t.raffleId, t.userId),
    uniqueIndex("entry_raffle_ticket_uniq").on(t.raffleId, t.ticket),
  ],
);

export type Raffle = typeof raffle.$inferSelect;
export type Entry = typeof entry.$inferSelect;
