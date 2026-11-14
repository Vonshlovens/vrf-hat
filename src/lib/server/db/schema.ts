import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.schema.ts";

export * from "./auth.schema.ts";

/**
 * open      – taking entries (for a repeating raffle: also between rounds)
 * requested – a round's list is committed on-chain, waiting for Chainlink VRF
 * drawn     – finished; no more draws
 */
export const raffleStatus = pgEnum("raffle_status", ["open", "requested", "drawn"]);

/** What being pulled from the hat means. Fixed at creation and baked into each round's on-chain key. */
export const raffleMode = pgEnum("raffle_mode", ["win", "eliminate"]);

export const repeatUnit = pgEnum("repeat_unit", ["hour", "day", "week"]);

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
    mode: raffleMode("mode").notNull().default("win"),
    /** Tickets pulled per draw: winners, or eliminations in `eliminate` mode. */
    winnerCount: integer("winner_count").notNull().default(1),
    /** Whether signed-in people can add themselves, or only the host adds names. */
    selfEntry: boolean("self_entry").notNull().default(true),
    status: raffleStatus("status").notNull().default("open"),

    /** More than one draw. After each round the raffle reopens until it finishes. */
    recurring: boolean("recurring").notNull().default(false),
    /** Schedule for a repeating raffle; all null when the host starts each round by hand. */
    repeatEvery: integer("repeat_every"),
    repeatUnit: repeatUnit("repeat_unit"),
    /** IANA zone the schedule keeps wall-clock time in. */
    timezone: text("timezone"),
    nextDrawAt: timestamp("next_draw_at", { withTimezone: true }),
    /** Finish after this many draws. Null: run until the hat runs out. */
    maxDraws: integer("max_draws"),
    /** `win` mode: winning tickets go back in the hat for later rounds. */
    returnPicked: boolean("return_picked").notNull().default(false),
    /** `eliminate` mode: a repeating raffle finishes when this many names are left. */
    keepCount: integer("keep_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("raffle_host_idx").on(t.hostId),
    index("raffle_due_idx").on(t.nextDrawAt),
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
    /** Random 16-byte ticket, hex. Part of every committed leaf for this entry. */
    ticket: text("ticket").notNull(),
    /** How many tickets this name holds. Each one is a separate slot in a sealed list. */
    count: integer("count").notNull().default(1),
    /** How many of its tickets have been pulled, over all rounds. Rebuilt from `draw_slot`. */
    picked: integer("picked").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entry_raffle_idx").on(t.raffleId),
    uniqueIndex("entry_raffle_user_uniq").on(t.raffleId, t.userId),
    uniqueIndex("entry_raffle_ticket_uniq").on(t.raffleId, t.ticket),
    check("entry_count_positive", sql`${t.count} > 0`),
  ],
);

/** One round: a sealed list, one VRF request, one random word. */
export const draw = pgTable(
  "draw",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id")
      .notNull()
      .references(() => raffle.id, { onDelete: "cascade" }),
    /** 1-based. */
    round: integer("round").notNull(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    raffleKey: text("raffle_key").notNull(),
    /** Tickets pulled this round; `winnerCount` on-chain. */
    pickCount: integer("pick_count").notNull(),

    // Set once the request transaction is sent.
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
  (t) => [uniqueIndex("draw_raffle_round_uniq").on(t.raffleId, t.round)],
);

/**
 * A round's sealed list, one row per ticket. Label and ticket are copied in so
 * the published list can't change when an entry is edited or removed later.
 */
export const drawSlot = pgTable(
  "draw_slot",
  {
    drawId: uuid("draw_id")
      .notNull()
      .references(() => draw.id, { onDelete: "cascade" }),
    /** 0-based position in the committed list. */
    position: integer("position").notNull(),
    entryId: uuid("entry_id").references(() => entry.id, { onDelete: "set null" }),
    ticket: text("ticket").notNull(),
    label: text("label").notNull(),
    /** 0-based order in which this slot was pulled; null if it wasn't. */
    pickedRank: integer("picked_rank"),
  },
  (t) => [
    primaryKey({ columns: [t.drawId, t.position] }),
    index("draw_slot_entry_idx").on(t.entryId),
  ],
);

export type Raffle = typeof raffle.$inferSelect;
export type Entry = typeof entry.$inferSelect;
export type Draw = typeof draw.$inferSelect;
export type DrawSlot = typeof drawSlot.$inferSelect;
