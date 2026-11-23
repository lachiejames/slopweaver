/**
 * The plan register — the ONE list of destinations a session can be seated on — as one row in the store.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home
 * becomes deletable. The plan register is the first register to make that trip, because it is one bounded
 * document read on every seat, capacity check and Codex route. `src/plans/storePort.ts` is the only reader
 * and writer; `plans.json` and `claude-accounts/accounts.json` survive as one-way projections of this row
 * for checkouts that predate it.
 *
 * ## Why one document rather than a row per destination
 *
 * The register deliberately preserves fields the running version does not read (`src/plans/register.ts` §
 * "Raw rows survive a change"), and every change is validated against the WHOLE register — pin cardinality,
 * a paused pin, a duplicate store path. So a write is one bounded document, and the compare-and-set that
 * serialises writers is naturally document-wide. Normalising the rows would split that one judgement across
 * many rows and buy nothing a reader asks for.
 *
 * ## Why a singleton, and why the database enforces it
 *
 * One install has one register. The primary key is the literal {@link PLAN_REGISTER_ID} and a CHECK refuses
 * anything else, exactly as `./ownerProfile.ts` pins its own row, so `where id = 'plans'` is right by
 * construction. `revision` is what a write pins to: an integer rather than `updated_at`, because two writes
 * inside one clock tick are indistinguishable by time and a counter settles them.
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { PlanRegisterDocument } from "../../plans/types.js";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The only primary-key value `plan_register` accepts, spelled once so a reader and the CHECK agree. */
export const PLAN_REGISTER_ID = "plans";

/**
 * The register document, whole and raw, beside the revision a compare-and-set pins to.
 *
 * `document` is typed through `$type` for the writer's convenience only: `jsonb` is not runtime validation,
 * so every read decodes it with `parsePlanRegister` before anything routes on it.
 */
export const planRegisterTable = pgTable(
  "plan_register",
  {
    id: text("id").primaryKey(),
    document: jsonb("document").$type<PlanRegisterDocument>().notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("plan_register_is_singleton", sql.raw(`id = '${PLAN_REGISTER_ID}'`)),
    check("plan_register_revision_positive", sql`revision > 0`),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "plan_register" }),
  ],
);

/** The register row as the database returns it. */
export type PlanRegisterRow = typeof planRegisterTable.$inferSelect;

/** The register row as an insert takes it. */
export type NewPlanRegisterRow = typeof planRegisterTable.$inferInsert;
