/**
 * Every retired Codex pass — a review whose property WORDING could not be satisfied, or a pass that recorded
 * no tree — with the reason, as an insert-only table.
 *
 * `src/codex/supersession.ts` carries the owner rulings and the guards that make a
 * retirement impossible without a replacement. This table is where the register LIVES: the old
 * `codex-supersessions.jsonl` is imported once (`./homeFileImport.ts`) and never read again.
 *
 * ## One row per retired artifact, never overwritten
 *
 * A row retires exactly one pass, so `artifact_id` is the key and every insert is `ON CONFLICT DO NOTHING`. A
 * second retirement of the same pass is refused by `codex supersede` before it is written, and a race that
 * gets past that check meets the key: an identical row is the same act, a different one is reported as the
 * pass already being retired. Nothing edits a retirement once it is on the record.
 *
 * ## The two shapes, enforced by the database too
 *
 * `kind` is `wording` or `no-tree`. A wording row carries a property id and none of the no-tree fields; a
 * no-tree row carries its pass, mode and branch, and a property id exactly when it is a review. The CHECKs hold
 * the shape; the decoder also holds the review-names-a-property pairing, and refuses a row that breaks it.
 *
 * The bot is denied the table: a reason quotes review findings over private code.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** One retirement. */
export const codexSupersessionTable = pgTable(
  "codex_supersession",
  {
    /** The artifact id of the pass being retired. */
    artifactId: text("artifact_id").primaryKey(),
    kind: text("kind").$type<"wording" | "no-tree">().notNull(),
    /** The reviewed property id: always on a wording row, on a no-tree row only for a review. */
    propertyId: text("property_id"),
    /** The no-tree record's pass id. */
    pass: text("pass"),
    /** The no-tree record's arm. */
    mode: text("mode").$type<"plan" | "review">(),
    /** The only branch a no-tree retirement discounts its record for. */
    branch: text("branch"),
    reason: text("reason").notNull(),
    replacedBy: text("replaced_by").notNull(),
    /** When it was retired, exactly as the writer spelled it. */
    atIso: text("at_iso").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("codex_supersession_kind", sql`kind in ('wording', 'no-tree')`),
    check("codex_supersession_mode", sql`mode is null or mode in ('plan', 'review')`),
    check(
      "codex_supersession_wording_shape",
      sql`kind <> 'wording' or (property_id is not null and pass is null and mode is null and branch is null)`,
    ),
    check(
      "codex_supersession_no_tree_shape",
      sql`kind <> 'no-tree' or (pass is not null and mode is not null and branch is not null)`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "codex_supersession" }),
  ],
);

/** A retirement row as the database returns it. */
export type CodexSupersessionRow = typeof codexSupersessionTable.$inferSelect;
