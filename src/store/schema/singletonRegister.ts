/**
 * The small single-document registers an install keeps, one row each, in one table.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home becomes
 * deletable. Some of what lives there is one bounded document an install writes rarely — which Chrome profile the
 * browser legs use, this install's own `gmail triage` archive rows, the once-per-session stale-seat dedup marker.
 * Each is a row here, keyed by a literal id from {@link SINGLETON_REGISTER_IDS}. `src/store/singletonRegister.ts`
 * is the only reader and writer; each domain decodes its own document and names its own failures.
 *
 * ## Why one table rather than one per register
 *
 * Every register here has the same four columns, the same compare-and-set and the same policies, and nothing
 * about one is a column another lacks. One table makes the SQL one typed adapter instead of a copy per domain,
 * and adding a register is widening the id CHECK — the same one migration a new table would cost. The plan
 * register keeps its own `plan_register` table: it predates this one and carries projections none of these has.
 *
 * ## Why the database enforces the id set
 *
 * The CHECK refuses an id no register declares, so a typo in a reader cannot mint a second, silently empty
 * register beside the real one. `revision` is what a write pins to, an integer rather than `updated_at`, because
 * two writes inside one clock tick are indistinguishable by time and a counter settles them.
 *
 * The bot reads one of these, the identity roster, because a Slack-facing turn addresses people; no Slack-facing
 * answer needs a profile directory, a mailbox's archive rulings or a dedup marker, so its predicate names that one
 * id and nothing else (least privilege, as on a ledger).
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/**
 * Every register this table holds, spelled once so a reader, the CHECK and the home classification agree.
 *
 * - `browser-profile` — which of the owner's own Chrome profiles every browser leg uses (`src/browser/recordedProfile.ts`).
 * - `gmail-triage-rules` — this install's own `gmail triage` archive rows (`src/live/gmail/triageRuleStore.ts`).
 * - `stale-seat-notices` — which sessions were already told their seat is stale (`src/cli/staleSeatNoticeStore.ts`).
 * - `identity-roster` — the install's human-curated who-is-who override (`src/silver/identityRoster.ts`).
 */
export const SINGLETON_REGISTER_IDS = [
  "browser-profile",
  "gmail-triage-rules",
  "stale-seat-notices",
  "identity-roster",
  "claude-plan-probes",
] as const;

/**
 * The one register the bot may read: who a Slack handle names. A Slack-facing turn addresses people, and the
 * roster carries nothing private-lane — names, handles and per-source ids, the same columns `person` lets it read.
 */
const BOT_READABLE_REGISTER = "identity-roster" satisfies SingletonRegisterId;

/** One register's id. */
export type SingletonRegisterId = (typeof SINGLETON_REGISTER_IDS)[number];

/**
 * One register's document, whole and raw, beside the revision a compare-and-set pins to.
 *
 * `document` is `unknown` on purpose: `jsonb` is not runtime validation, so every read decodes it with its own
 * domain's parser before anything acts on it.
 */
export const singletonRegisterTable = pgTable(
  "singleton_register",
  {
    id: text("id").primaryKey(),
    document: jsonb("document").$type<unknown>().notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check(
      "singleton_register_known_id",
      sql.raw(`id in (${SINGLETON_REGISTER_IDS.map((id) => `'${id}'`).join(", ")})`),
    ),
    check("singleton_register_revision_positive", sql`revision > 0`),
    ...storeTablePolicies({ botRead: sql.raw(`id = '${BOT_READABLE_REGISTER}'`), table: "singleton_register" }),
  ],
);

/** One register row as the database returns it. */
export type SingletonRegisterRow = typeof singletonRegisterTable.$inferSelect;

/** One register row as an insert takes it. */
export type NewSingletonRegisterRow = typeof singletonRegisterTable.$inferInsert;
