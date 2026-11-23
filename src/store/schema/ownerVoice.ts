/**
 * The measured voice register — the owner's own length statistics, in the store rather than in a markdown file.
 *
 * The numbers live in the store, not in a `profile.json` register block.
 *
 * ## What this is for, stated before the columns
 *
 * Slopweaver can already tell a composer that a WORD is banned. It cannot tell it that a message is four
 * times too long for the surface it is going to, because the numbers that would say so were measured once,
 * once, over thousands of dictations and thousands of sent messages, and then written into a markdown file in
 * an archived repository that no code path reads. This table is where a check can reach them.
 *
 * ## The key is a cohort, not a surface
 *
 * One surface carries several populations. Every sampled Slack message the owner sent measures median 14 / p90 54;
 * a hundreds-message calibration against one colleague measures median 7 / p90 18. A single `slack` row would
 * have to pick one and would then describe neither, so the key is `(surface, cohort)` and a caller names
 * which population it is composing against.
 *
 * Every statistic is nullable, and that is the honest shape rather than a convenience: the source gives no
 * p75 for the DM cohorts at all, and no measured percentile for GitHub, Linear or Notion. A reader must be
 * able to tell "not measured" from "measured at zero", the same three-valued discipline `PlatformIdentity`
 * uses for a provider that was never asked.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { ownerProfileTable } from "./ownerProfile.js";
import { botSeesEverything, storeTablePolicies } from "./rls.js";

/**
 * One measured length cohort on one outbound surface.
 *
 * The CHECK is the arithmetic a percentile cannot violate and a bad import easily can — a negative word
 * count. Percentile ORDERING is deliberately not a CHECK: it is a relation a caller wants reported per
 * cohort with the cohort named, which `percentilesAreOrdered` in `../profile/types.ts` does, and a
 * constraint would refuse the write with the database's own wording instead.
 */
export const ownerVoiceRegisterTable = pgTable(
  "owner_voice_register",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => ownerProfileTable.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    cohort: text("cohort").notNull(),
    medianWords: integer("median_words"),
    p75Words: integer("p75_words"),
    p90Words: integer("p90_words"),
    ceilingWords: integer("ceiling_words"),
    sampleCount: integer("sample_count"),
    measuredAt: timestamp("measured_at", { mode: "date", withTimezone: true }).notNull(),
    source: text("source").notNull(),
    qualification: text("qualification").default("").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.surface, table.cohort], name: "owner_voice_register_pk" }),
    check(
      "owner_voice_register_non_negative",
      sql`(median_words is null or median_words >= 0)
        and (p75_words is null or p75_words >= 0)
        and (p90_words is null or p90_words >= 0)
        and (ceiling_words is null or ceiling_words >= 0)
        and (sample_count is null or sample_count >= 0)`,
    ),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "owner_voice_register" }),
  ],
);

/** One cohort as the database returns it. */
export type OwnerVoiceRegisterRow = typeof ownerVoiceRegisterTable.$inferSelect;

/** One cohort as an insert takes it. */
export type NewOwnerVoiceRegisterRow = typeof ownerVoiceRegisterTable.$inferInsert;
