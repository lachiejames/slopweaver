/**
 * What the Codex fleet's LIVE read last found about each registered Codex store's sign-in — one row per plan alias.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home becomes
 * deletable. These rows replace `codex-signin/<alias>.json`: `src/codex/signInRecordStore.ts` is the only reader and
 * writer, a file left from before is imported from once per alias, and nothing is projected back to disk.
 *
 * ## Why a row per alias rather than one document
 *
 * Several passes read the fleet at once, and each files only the aliases it observed. One row per alias keeps two
 * concurrent reads from contending over a third store's observation, which is what the per-alias file and its
 * per-alias lock bought before.
 *
 * ## Why `revision` is the compare-and-set pin and `readAtIso` is not in the predicate
 *
 * Which observation replaces which is a ONE-SIDED rule (`src/codex/signInRecord.ts`'s `nextCodexSignInRecord`): a
 * refusal always files, an older signed-in read never undoes a newer refusal. A timestamp predicate here would
 * make that policy symmetric. So the pure function judges against the row it read, and the update lands only if
 * the row is still at that `revision` — an integer, because two writes inside one clock tick are
 * indistinguishable by time.
 *
 * `record` is typed through `$type` for the writer's convenience only: every read decodes it with
 * `decodeCodexSignInRecord` before anything is ordered against it.
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { CodexSignInRecord } from "../../codex/signInRecord.js";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** One alias's newest observation, whole, beside the revision a compare-and-set pins to. */
export const codexSignInObservationTable = pgTable(
  "codex_sign_in_observation",
  {
    alias: text("alias").primaryKey(),
    record: jsonb("record").$type<CodexSignInRecord>().notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("codex_sign_in_observation_revision_positive", sql`revision > 0`),
    // An alias and a store path the plan register already shows the bot, and `auth.json`'s stat — never a byte.
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "codex_sign_in_observation" }),
  ],
);

/** One observation row as the database returns it. */
export type CodexSignInObservationRow = typeof codexSignInObservationTable.$inferSelect;
