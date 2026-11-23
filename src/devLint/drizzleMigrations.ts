/**
 * The three things that can be wrong with a generated migration and are wrong nowhere a test would look.
 *
 * Ported as DESIGN from the archive's `check-drizzle-schema --journal` and
 * `check-drizzle-migration-safety` (AGENTS.md § "Porting from private sources"), re-implemented here
 * against this repo's own layout and with a criterion of its own rather than its allowlist. The apply loop
 * lands with its gates, because an apply loop with nothing checking what it applies just applies a broken migration faster.
 *
 * Each check below is a class that has actually fired in one of the two repositories, and each is
 * invisible to every other gate here:
 *
 * - **Coverage.** A table declared in the schema whose `CREATE TABLE` is not in any migration. This is
 *   what generating a migration being a step a PERSON runs makes possible: the schema changes, the DDL
 *   does not, and the typed client compiles against columns the database has never had. The unit lane
 *   has a drift test, but a gate is what makes the check run on a tree nobody thought to open.
 * - **Journal order.** `drizzle-orm`'s migrator applies files in the journal's order and records each by
 *   hash. Two branches that both generate a migration produce two entries with the same index or with
 *   timestamps out of order, and the second one to land applies in an order nobody reviewed. An orphaned
 *   `.sql` — on disk, absent from the journal — is the same defect wearing the other hat: it is never
 *   applied, and nothing says so.
 * - **Single-transaction safety.** `migrate()` runs every pending migration inside ONE transaction, and
 *   Postgres refuses several statements there: a newly added enum value cannot be used in the same
 *   transaction that added it, and `CREATE INDEX CONCURRENTLY` cannot run in one at all. The failure is
 *   at apply time, on whatever database is unlucky enough to be first.
 *
 * Three more join them, so those mistakes are structurally impossible, and each closes a hole the first three could not see:
 *
 * - **Drift.** The coverage check reads `CREATE TABLE` and nothing else, so a column, an index, a CHECK
 *   or a policy added to the schema with no migration passed it. The drift check asks `drizzle-kit` itself
 *   — the CLI `generate`, run into a scratch copy of the migrations directory, needs no database and
 *   emits a new `.sql` exactly when the schema and the committed migrations disagree about ANYTHING.
 * - **Row-level security.** Every table must carry exactly the three policies `storeTablePolicies` builds
 *   — owner `all`, agent `select`, bot `select`, each to its own role — and drizzle's own table config
 *   must say RLS is enabled. Read from the table objects, so a table declared with `pgTable` and no
 *   policies fails here before it can generate.
 * - **The barrel.** Every `pgTable` and `pgEnum` declared in a module under `src/store/schema/` must be
 *   exported by `src/store/schema.ts`, because the barrel is what drizzle-kit, the grants, the enum
 *   labels, the verifier and the other two checks all read; a module left out of it is invisible to every
 *   one of them at once. The archive's `check-drizzle-schema` is the design.
 *
 * There is no allowlist and no exemption marker in any of the six. A migration that genuinely needs an
 * unsafe statement needs it applied outside the transaction, which is a change to the apply loop rather
 * than a licence in the file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { absentAs } from "#lib/absent.js";

/** Where `drizzle-kit` writes, and where the migrator reads. One place, named once. */
export const MIGRATIONS_DIRNAME = join("supabase", "migrations");

/** One entry in `meta/_journal.json`, which is drizzle's own record of what to apply and in what order. */
export interface JournalEntry {
  /** Position in the apply order. */
  readonly idx: number;
  /** The migration's file name without its extension. */
  readonly tag: string;
  /** When drizzle-kit generated it, in epoch milliseconds. */
  readonly when: number;
}

/** One thing wrong with the migrations or the schema, as a line a reader can act on. */
export interface MigrationViolation {
  /** Which of the six checks found it. */
  readonly check: "barrel" | "coverage" | "drift" | "journal" | "rls" | "safety";
  /** What is wrong, and where. */
  readonly message: string;
}

/** One declared policy, reduced to the three facts the RLS check judges. */
export interface DeclaredPolicy {
  readonly name: string;
  readonly for: string | undefined;
  readonly to: string | undefined;
}

/** One declared table with the row-level-security facts drizzle's own config carries for it. */
export interface DeclaredTableRls {
  readonly table: string;
  readonly rlsEnabled: boolean;
  readonly policies: readonly DeclaredPolicy[];
}

/**
 * The three policies every store table must carry, in the order `storeTablePolicies` emits them.
 *
 * Spelled here rather than imported from `schema/rls.ts` on purpose: the gate is what catches that module
 * being edited to emit fewer, so it cannot take its expectation from the thing it checks.
 *
 * @param table the Postgres table name
 * @returns the expected name, operation and role of each policy
 */
export function expectedPolicies({ table }: { table: string }): readonly DeclaredPolicy[] {
  return [
    { for: "all", name: `${table}_owner_all`, to: "slopweaver_owner" },
    { for: "select", name: `${table}_agent_read`, to: "slopweaver_agent" },
    { for: "select", name: `${table}_bot_read`, to: "slopweaver_bot" },
  ];
}

/**
 * Every table whose row-level security is not exactly the declared shape.
 *
 * Exactly, not at least: an extra policy is as much a finding as a missing one, because a fourth policy
 * granting the bot `insert` would widen the one denial this whole mechanism exists for and read as fine
 * to a check that only counted three.
 *
 * @param tables every declared table with its config's policies
 * @returns one message per defect, in table order
 */
export function rlsViolations({ tables }: { tables: readonly DeclaredTableRls[] }): readonly string[] {
  const out: string[] = [];
  for (const { table, rlsEnabled, policies } of tables) {
    if (!rlsEnabled) {
      out.push(`"${table}" does not enable row level security — spread storeTablePolicies() into its extras`);
    }
    const expected = expectedPolicies({ table });
    const actual = policies.map(
      (policy) =>
        `${policy.name} for ${absentAs({ value: policy.for, whenAbsent: "?" })} to ${absentAs({ value: policy.to, whenAbsent: "?" })}`,
    );
    const wanted = expected.map(
      (policy) =>
        `${policy.name} for ${absentAs({ value: policy.for, whenAbsent: "?" })} to ${absentAs({ value: policy.to, whenAbsent: "?" })}`,
    );
    for (const missing of wanted.filter((entry) => !actual.includes(entry))) {
      out.push(`"${table}" is missing policy ${missing}`);
    }
    for (const extra of actual.filter((entry) => !wanted.includes(entry))) {
      out.push(`"${table}" carries an undeclared policy ${extra}`);
    }
  }
  return out;
}

/** What one module under `src/store/schema/` declares, by Postgres name. */
export interface SchemaModuleDeclarations {
  readonly file: string;
  readonly tables: readonly string[];
  readonly enums: readonly string[];
}

/**
 * Every table or enum a schema module declares that the barrel does not export.
 *
 * @param modules what each module under the schema directory declares
 * @param barrelTables the table names the barrel exports
 * @param barrelEnums the enum names the barrel exports
 * @returns one message per declaration the barrel is missing
 */
export function barrelViolations({
  modules,
  barrelTables,
  barrelEnums,
}: {
  modules: readonly SchemaModuleDeclarations[];
  barrelTables: readonly string[];
  barrelEnums: readonly string[];
}): readonly string[] {
  const tables = new Set(barrelTables);
  const enums = new Set(barrelEnums);
  const out: string[] = [];
  for (const module of modules) {
    for (const table of module.tables.filter((name) => !tables.has(name))) {
      out.push(`${module.file} declares table "${table}" and src/store/schema.ts does not export it`);
    }
    for (const enumeration of module.enums.filter((name) => !enums.has(name))) {
      out.push(`${module.file} declares enum "${enumeration}" and src/store/schema.ts does not export it`);
    }
  }
  return out;
}

/**
 * The migration files `drizzle-kit generate` ADDED to a scratch copy of the directory — each one a change
 * the schema carries and no committed migration does.
 *
 * @param before the `.sql` names in the directory before the generate
 * @param after the `.sql` names after it
 * @returns one message per new file
 */
export function driftViolations({
  before,
  after,
}: {
  before: readonly string[];
  after: readonly string[];
}): readonly string[] {
  const committed = new Set(before);
  return after
    .filter((name) => !committed.has(name))
    .map((name) => `the schema has changed and no committed migration carries it — drizzle-kit would emit ${name}`);
}

/**
 * Every table the schema declares whose `CREATE TABLE` no migration carries.
 *
 * Compares the two sides that must agree and are produced by different acts: the table names come from
 * the schema modules (what the code believes), the `CREATE TABLE` statements from the emitted SQL (what
 * the database will have). The check is deliberately one-directional — a migration may legitimately
 * create a table a later migration dropped — so a name in the SQL and not in the schema is not a
 * finding, while the reverse always is.
 *
 * @param declared every table name the schema declares
 * @param sql every migration's SQL, concatenated
 * @returns the declared tables with no `CREATE TABLE` in the SQL, in declaration order
 */
export function tablesMissingFromMigrations({
  declared,
  sql,
}: {
  declared: readonly string[];
  sql: string;
}): readonly string[] {
  return declared.filter((table) => !sql.includes(`CREATE TABLE "${table}"`));
}

/**
 * Journal entries whose index or timestamp does not strictly increase.
 *
 * Both axes matter and they fail differently. A repeated or out-of-order `idx` means two branches each
 * generated a migration and the merge kept both, so the apply order is whichever one sorted first rather
 * than one anybody chose. An out-of-order `when` with a clean `idx` is the same collision after a rebase
 * moved the commits but not the file contents.
 *
 * @param entries the journal's entries, in the order the file lists them
 * @returns one message per entry that does not increase on both axes
 */
export function journalOrderViolations({ entries }: { entries: readonly JournalEntry[] }): readonly string[] {
  const out: string[] = [];
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1];
    const current = entries[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (current.idx <= previous.idx) {
      out.push(
        `${current.tag} has idx ${String(current.idx)}, not greater than ${previous.tag}'s ${String(previous.idx)}`,
      );
    }
    if (current.when <= previous.when) {
      out.push(
        `${current.tag} was generated at ${String(current.when)}, not after ${previous.tag}'s ${String(previous.when)} — two branches both generated a migration`,
      );
    }
  }
  return out;
}

/**
 * Migration files on disk that the journal never names, and journal entries with no file.
 *
 * The first is never applied and nothing says so; the second makes the migrator throw at apply time on
 * a file it cannot open. Both are what a merge produces when it takes one side of `_journal.json` and
 * both sides of the directory.
 *
 * @param journalTags every tag the journal lists
 * @param fileTags every `.sql` file name on disk, without its extension
 * @returns one message per file with no entry, then one per entry with no file
 */
export function journalFileMismatches({
  journalTags,
  fileTags,
}: {
  journalTags: readonly string[];
  fileTags: readonly string[];
}): readonly string[] {
  const inJournal = new Set(journalTags);
  const onDisk = new Set(fileTags);
  return [
    ...fileTags
      .filter((tag) => !inJournal.has(tag))
      .map((tag) => `${tag}.sql is on disk but not in the journal, so it is never applied`),
    ...journalTags
      .filter((tag) => !onDisk.has(tag))
      .map((tag) => `the journal names ${tag} but ${tag}.sql is not on disk`),
  ];
}

/**
 * Statement shapes Postgres refuses inside the migrator's single transaction.
 *
 * Each pattern is here because the statement is legal SQL that fails only when wrapped, which is why
 * neither a generator nor a reviewer catches it:
 *
 * - `ALTER TYPE … ADD VALUE` commits the new label, and a later statement in the SAME transaction cannot
 *   use it — so a migration that adds an enum value and then indexes on it fails on the second half.
 * - `DROP TYPE` on a type any pending statement still references fails for the same reason inverted.
 * - `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` cannot run in a transaction block at all.
 * - `VACUUM` likewise.
 *
 * @internal
 */
const UNSAFE_PATTERNS: readonly { readonly pattern: RegExp; readonly second?: RegExp; readonly why: string }[] = [
  {
    // Two anchored halves rather than one pattern spanning them. `ALTER TYPE … ADD VALUE` with an
    // unbounded `[^;]*` in the middle is polynomial-backtracking (the `redos-check` gate refuses it), and
    // the span is not load-bearing here anyway: a statement carrying both tokens is the one being caught,
    // and drizzle's `--> statement-breakpoint` split already guarantees they belong to the same statement.
    pattern: /\bALTER\s+TYPE\b/i,
    second: /\bADD\s+VALUE\b/i,
    why: "a new enum value cannot be used in the transaction that added it",
  },
  { pattern: /\bDROP\s+TYPE\b/i, why: "dropping a type a pending statement still references fails" },
  { pattern: /\bCONCURRENTLY\b/i, why: "CONCURRENTLY cannot run inside a transaction block" },
  { pattern: /^\s*VACUUM\b/im, why: "VACUUM cannot run inside a transaction block" },
];

/**
 * Which statements in one migration would break the single-transaction runner.
 *
 * Splits on drizzle's own `--> statement-breakpoint` marker so a message can name the statement rather
 * than the file, and so a pattern cannot match across two unrelated statements.
 *
 * @param sql one migration file's contents
 * @param tag the migration's name, for the message
 * @returns one message per offending statement
 */
export function unsafeStatements({ sql, tag }: { sql: string; tag: string }): readonly string[] {
  const statements = sql.split("--> statement-breakpoint");
  const out: string[] = [];
  for (const statement of statements) {
    for (const { pattern, second, why } of UNSAFE_PATTERNS) {
      if (!pattern.test(statement)) {
        continue;
      }
      if (second !== undefined && !second.test(statement)) {
        continue;
      }
      out.push(`${tag}: ${why} — ${firstLine({ statement })}`);
    }
  }
  return out;
}

/**
 * The first line of a statement, for a message that names what was found rather than quoting the file.
 *
 * `split` on a non-empty string always yields at least one element, so this indexes it with a non-null
 * assertion rather than coalescing to an empty string — an empty quote in a violation message would read
 * as "this statement is blank", which is never what happened.
 *
 * @param statement one migration statement
 * @returns its first line, trimmed
 * @internal
 */
function firstLine({ statement }: { statement: string }): string {
  return statement.trim().split("\n", 1)[0]!;
}

/** What one directory of migrations holds, read once and checked three ways. */
export interface MigrationSet {
  /** Every `.sql` file's tag and contents, in file-name order. */
  readonly files: readonly { readonly tag: string; readonly sql: string }[];
  /** The journal's entries, or an empty list when the journal is absent. */
  readonly entries: readonly JournalEntry[];
  /** Whether `meta/_journal.json` was found and parsed. */
  readonly journalPresent: boolean;
  /**
   * Why the journal could not be USED, when it is there and something other than absence stopped it — it
   * could not be read, or it read fine and is not a journal. Either way the gate never saw an apply order,
   * so it has a fact to report rather than a verdict about one.
   */
  readonly journalUnreadable: string | undefined;
}

/**
 * Read a migrations directory: every `.sql` file, and the journal beside them.
 *
 * @param dir the migrations directory
 * @returns the files and the journal entries
 */
export function readMigrationSet({ dir }: { dir: string }): MigrationSet {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ sql: readFileSync(join(dir, name), "utf8"), tag: name.slice(0, -4) }));

  let entries: readonly JournalEntry[] = [];
  let journalPresent = false;
  let journalUnreadable: string | undefined;
  try {
    const raw = readFileSync(join(dir, "meta", "_journal.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    journalPresent = true;
    if (isJournal(parsed)) {
      entries = parsed.entries;
    } else {
      // Valid JSON that is not a journal. Leaving `entries` empty here made every migration file look like
      // a journal MISMATCH, so the four lines reported N disagreements when the truth is one unusable file.
      journalUnreadable = "it parses as JSON but carries no `entries` list, so it is not a journal";
    }
  } catch (error: unknown) {
    // ABSENT and UNREADABLE are different answers: nothing recording the apply order is a POLICY violation,
    // while a journal that is there and cannot be read is a FACT the gate reports without a verdict. They
    // were one `journalPresent = false` before, so an EACCES printed the four lines claiming it was absent.
    journalPresent = false;
    journalUnreadable = isNotFoundError({ error }) ? undefined : String(error);
  }
  return { entries, files, journalPresent, journalUnreadable };
}

/**
 * Whether a caught read error is the journal simply not being there.
 *
 * @param error whatever the read or parse threw
 * @returns true only for ENOENT — anything else is a journal that exists and could not be used
 */
function isNotFoundError({ error }: { error: unknown }): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const { code } = error;
  return code === "ENOENT";
}

/**
 * Whether a parsed value carries the journal's entry list.
 *
 * @returns whether the value is a journal document
 * @internal
 */
function isJournal(value: unknown): value is { entries: JournalEntry[] } {
  if (typeof value !== "object" || value === null || !("entries" in value)) {
    return false;
  }
  const { entries } = value;
  return Array.isArray(entries);
}

/** Everything the six checks read, gathered by the entry point so the checks themselves stay pure. */
export interface SchemaGateInput {
  /** The migrations as read from disk. */
  readonly set: MigrationSet;
  /** Every table name the schema barrel declares. */
  readonly declaredTables: readonly string[];
  /** Every declared table with its row-level-security config. */
  readonly rls: readonly DeclaredTableRls[];
  /** What each module under the schema directory declares, against what the barrel exports. */
  readonly barrel: {
    readonly modules: readonly SchemaModuleDeclarations[];
    readonly barrelTables: readonly string[];
    readonly barrelEnums: readonly string[];
  };
  /** The migration file names before and after a scratch `drizzle-kit generate`. */
  readonly drift: { readonly before: readonly string[]; readonly after: readonly string[] };
}

/**
 * Every violation across all six checks.
 *
 * One function rather than six entry points because the failures share one read of the directory and
 * one read of the barrel, and because a run that reports "journal fine" while the coverage check never
 * ran is exactly the partial green this gate exists to replace. Every input is REQUIRED for the same
 * reason: an optional one is a check that can be skipped without anything saying so.
 *
 * @param input everything the checks read
 * @returns every violation — barrel, then rls, then coverage, drift, journal, safety
 */
export function migrationViolations(input: SchemaGateInput): readonly MigrationViolation[] {
  const { set, declaredTables } = input;
  const out: MigrationViolation[] = [];

  for (const message of barrelViolations(input.barrel)) {
    out.push({ check: "barrel", message });
  }
  for (const message of rlsViolations({ tables: input.rls })) {
    out.push({ check: "rls", message });
  }

  const sql = set.files.map((file) => file.sql).join("\n");
  for (const table of tablesMissingFromMigrations({ declared: declaredTables, sql })) {
    out.push({
      check: "coverage",
      message: `the schema declares "${table}" and no migration creates it — run \`slopweaver store push\` and commit the migration it generates`,
    });
  }
  for (const message of driftViolations(input.drift)) {
    out.push({ check: "drift", message: `${message}; run \`slopweaver store push\` and commit the migration` });
  }

  if (!set.journalPresent) {
    out.push({ check: "journal", message: "meta/_journal.json is absent, so nothing records the apply order" });
  }
  for (const message of journalOrderViolations({ entries: set.entries })) {
    out.push({ check: "journal", message });
  }
  for (const message of journalFileMismatches({
    fileTags: set.files.map((file) => file.tag),
    journalTags: set.entries.map((entry) => entry.tag),
  })) {
    out.push({ check: "journal", message });
  }

  for (const file of set.files) {
    for (const message of unsafeStatements({ sql: file.sql, tag: file.tag })) {
      out.push({ check: "safety", message });
    }
  }

  return out;
}
