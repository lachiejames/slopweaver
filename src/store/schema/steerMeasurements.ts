/**
 * The owner's steer measurements — which kind of correction each owner turn names about the Slack drafts written as the owner —
 * as the one store table that IS their authority (`src/profile/steerKinds.ts` is the domain).
 *
 * The old `judgement/steer-kinds.jsonl` journal is imported once (`./homeFileImport.ts`, register
 * `steer-measurements`) and never answers a read again; its marker records the file's sha256 and size, and every
 * later operation checks the path against them, so a file changed after the import is refused rather than ignored.
 *
 * ## One table, the exact lines, nothing projected
 *
 * A row is one journal line exactly as the file held it or `steerVerdictLine` wrote it, ordered by `journal_seq`.
 * There are no parsed columns: every read parses the lines with the journal's own grammar, so there is no
 * projection that could disagree with them, and a line that does not parse is kept and read back as one — the
 * Alignment page's warning names it by its sequence, which for an imported line IS its 1-based line number in the
 * file, blanks counted, so the warning names the same line before and after the import.
 *
 * An imported row's id is `steer-legacy-<sha256>` over its exact text and its place in the file, so two installs
 * importing the same file name every measurement alike; a later one's is `steer-event-<uuid>`. Whatever the origin,
 * a row carries a source ordinal exactly when its id is a legacy one, a store import's included, so every row the
 * table admits is one an export's strict envelope reads back.
 *
 * ## Append-only in the database
 *
 * A measurement is never changed or removed — a wrong read is taken back by a `withdrawn` line — so update, delete
 * and truncate are refused by triggers enabled ALWAYS ({@link STEER_MEASUREMENT_IMMUTABLE_STATEMENTS}, installed by
 * the apply's guard phase), which fire in replica mode too.
 *
 * The bot is denied it, as it is every judgement table.
 */
import { sql } from "drizzle-orm";
import { bigint, check, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/**
 * Which writer produced a measurement: the one-time import of the home file, `profile steers judge`, or an applied
 * store import (`store import --apply`).
 */
export const steerMeasurementOriginEnum = pgEnum("steer_measurement_origin", [
  "legacy-file",
  "profile",
  "store-import",
]);

/** One measurement: one journal line, kept exactly. */
export const steerMeasurementTable = pgTable(
  "steer_measurement",
  {
    eventId: text("event_id").primaryKey(),
    journalSeq: bigint("journal_seq", { mode: "number" }).notNull().unique("uq_steer_measurement_seq"),
    origin: steerMeasurementOriginEnum("origin").notNull(),
    /** The journal line, exactly as the file held it or `steerVerdictLine` wrote it. */
    exactLine: text("exact_line").notNull(),
    /** The line's 1-based place in the file it was imported from; `null` on a line `profile steers judge` wrote. */
    sourceOrdinal: bigint("source_ordinal", { mode: "number" }),
    storedAt: timestamp("stored_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check(
      "steer_measurement_event_id",
      sql`event_id ~ '^steer-(legacy-[0-9a-f]{64}|event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'`,
    ),
    // Both bigints are read in `number` mode, so each is held to a safe integer: past 2^53 - 1 a read would round
    // it, and a rounded ordinal re-derives a different legacy id.
    check("steer_measurement_seq", sql`journal_seq > 0 and journal_seq <= 9007199254740991`),
    // Nonblank by ECMAScript's own whitespace set, spelled out: `\S` here follows the database's locale, so a line
    // the table took could be one every JavaScript reader calls blank (U+FEFF under LC_CTYPE=C). And ONE
    // line: an LF inside a row would export as two journal lines, one measurement read back as two.
    check(
      "steer_measurement_line",
      sql`exact_line ~ '[^\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]' and strpos(exact_line, chr(10)) = 0`,
    ),
    check(
      "steer_measurement_source_ordinal",
      sql`source_ordinal is null or (source_ordinal > 0 and source_ordinal <= 9007199254740991)`,
    ),
    check(
      "steer_measurement_legacy",
      sql`(origin <> 'legacy-file' or (event_id like 'steer-legacy-%' and source_ordinal = journal_seq))
        and (origin <> 'profile' or (event_id like 'steer-event-%' and source_ordinal is null))
        and ((event_id like 'steer-legacy-%') = (source_ordinal is not null))`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "steer_measurement" }),
  ],
);

/** A measurement row as the database returns it. */
export type SteerMeasurementRow = typeof steerMeasurementTable.$inferSelect;

/** The triggers that keep the table append-only, each by the table it guards. */
export const STEER_MEASUREMENT_TRIGGERS: readonly {
  readonly table: string;
  readonly name: string;
  readonly fires: string;
}[] = [
  {
    fires:
      "before update or delete on public.steer_measurement for each row execute function public.steer_measurement_kept()",
    name: "trg_steer_measurement_kept",
    table: "steer_measurement",
  },
  {
    fires:
      "before truncate on public.steer_measurement for each statement execute function public.steer_measurement_kept()",
    name: "trg_steer_measurement_no_truncate",
    table: "steer_measurement",
  },
];

/**
 * The statements that keep every measurement as it was written, whoever issues the statement: the function, then
 * each trigger by `create or replace trigger` and `enable always` in ONE `do` block — the same shape, and for the
 * same reasons, as the staging guards (`./importStaging.ts`'s `IMPORT_STAGING_IMMUTABLE_STATEMENTS`): no window
 * between a drop and a create, and never a trigger left firing in origin mode only.
 *
 * @returns the statements a migration's guard phase runs, in order, idempotently
 */
export const STEER_MEASUREMENT_IMMUTABLE_STATEMENTS: readonly string[] = [
  `create or replace function public.steer_measurement_kept() returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception 'a steer measurement is never changed or removed (% on %): a wrong read is taken back by a withdrawn line', tg_op, tg_table_name;
      end $$`,
  ...STEER_MEASUREMENT_TRIGGERS.map(
    (trigger) =>
      `do $$ begin
        create or replace trigger ${trigger.name} ${trigger.fires};
        alter table public.${trigger.table} enable always trigger ${trigger.name};
      end $$`,
  ),
];
