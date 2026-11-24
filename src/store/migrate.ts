/**
 * Apply the store's schema to Postgres: the roles, the generated migration, and the guards a migration
 * file cannot carry — in that order, in one act.
 *
 * ## What this file was, and the defect that changed it
 *
 * It applied the guards and nothing else. MEASURED across the whole tree: the ONLY two
 * references to `supabase/migrations/` anywhere were `drizzle.config.ts`'s write target and one row in
 * `docs/store.md`, and the two unit tests that read the directory assert over the SQL **as text**.
 * Nothing executed it. Reproduce on any commit before this one with
 * `grep -rn "supabase/migrations" --include="*.ts" --include="*.json" --include="*.yml" . | grep -v node_modules`.
 *
 * So the loop was: change the schema, generate a migration by hand, then a person pipes the file through
 * `psql` stripping the `--> statement-breakpoint` markers by hand. That is not a loop, it is a person —
 * and it is how the ordering defect in the first migration reached a human instead of a test:
 * `drizzle-kit` emitted the composite foreign keys BEFORE the unique index they reference, which
 * Postgres refuses. It also meant there was no non-destructive path at all: with no record of what had
 * been applied, picking up a new migration meant dropping the database.
 *
 * The rule: port the archive's
 * `db-push` — the programmatic `drizzle-orm` migrator with its `drizzle.__drizzle_migrations`
 * bookkeeping — before anything else is built on top of the store.
 *
 * ## Why the programmatic migrator rather than `drizzle-kit migrate`
 *
 * The archive's own note, and it holds here: `drizzle-kit migrate` swallows SQL errors behind a spinner,
 * reads its connection from a config file whose environment can disagree with the caller's, and gives a
 * failure no statement to point at. `migrate()` from `drizzle-orm/postgres-js/migrator` takes the
 * connection it is handed and throws the driver's own error. This repository ALSO has a reason the
 * archive did not: `postgres.js` builds its message from the failed statement plus every bound
 * parameter, so the error is walked to its first line and capped by {@link firstLineOf} rather than
 * printed whole — the same hole `StoreErrors.queryFailed` closed after a failed batch printed 962,926
 * bytes of the corpus to a terminal.
 *
 * ## The three phases, and why the order is forced rather than chosen
 *
 * 1. **Roles.** `create policy … to slopweaver_owner` fails if that role does not exist, and the roles
 *    are not in the migration — drizzle emits no `CREATE ROLE`, and telling drizzle-kit to manage roles
 *    on a Supabase database makes it generate DROPs for Supabase's own (`src/store/schema/rls.ts`).
 * 2. **The migration.** Tables, columns, indexes, CHECKs and — since the policies moved inside the
 *    tables — every `CREATE POLICY` and `ENABLE ROW LEVEL SECURITY`.
 * 3. **The guards.** Triggers and grants, which drizzle has no builder for, and which need the tables to
 *    exist. A `GRANT SELECT` on a table that is not there is an error, not a no-op.
 *
 * Run against the local stack: `yarn store:start`, then `slopweaver store push`. It refuses a connection
 * string it was not given rather than defaulting to one, because a migration that silently picks a
 * database is a migration that can run against the wrong one.
 */
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { installedTreeRoot } from "#lib/pluginRoot.js";
import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { type StoreError, StoreErrors } from "./errors.js";

import {
  enumValueStatements,
  storeExtensionStatements,
  storeRoleStatements,
  storeTableGrantStatements,
} from "./policies.js";

import { IMPORT_STAGING_IMMUTABLE_STATEMENTS } from "./schema/importStaging.js";
import { QUEUE_CHANGE_NOTIFY_STATEMENTS } from "./schema/queueChangeNotify.js";
import { SOURCE_ROW_PRESENCE_STATEMENTS } from "./schema/sourceRows.js";
import { STEER_MEASUREMENT_IMMUTABLE_STATEMENTS } from "./schema/steerMeasurements.js";

/**
 * The environment variable holding the store's connection string.
 *
 * Re-exported from {@link ./config} rather than declared twice: a migration and a query resolving the
 * word "configured" differently is how one of them ends up applied to a database the other never reads.
 *
 * @internal
 */
export { STORE_URL_ENV } from "./config.js";

/**
 * Where `drizzle-kit` writes the migrations and where the migrator reads them.
 *
 * One constant, because the generator's target and the applier's source disagreeing is precisely the
 * class this whole file exists to close: `drizzle.config.ts` writes here, and nothing used to read it.
 *
 * @internal
 */
export const MIGRATIONS_DIR = "supabase/migrations";

/**
 * How much of a driver error is ever printed.
 *
 * `postgres.js` builds its message from the failed statement plus every bound parameter, so an
 * unbounded print of a migration failure can spill whatever the transaction was carrying. 300 is the
 * same cap `StoreErrors.queryFailed` settled on for the same reason.
 *
 * @internal
 */
const ERROR_CHARS = 300;

/**
 * The first line of an error's message, capped — never the bound parameters underneath it.
 *
 * @param error whatever was thrown
 * @returns one line, at most {@link ERROR_CHARS} characters
 * @internal
 */
export function firstLineOf({ error }: { error: unknown }): string {
  const whole = errorMessage({ error });
  // Index 0 always exists: a split on a non-empty separator with a limit of one yields exactly one element.
  const first = whole.split("\n", 1)[0]!;
  return first.length > ERROR_CHARS ? `${first.slice(0, ERROR_CHARS)}…` : first;
}

/**
 * The statements that must run BEFORE the generated migration.
 *
 * The extensions, then the roles. Every policy in the migration names a role, and a `CREATE POLICY`
 * naming one that does not exist fails the whole transaction; the two trigram indexes name an operator
 * class only `create extension pg_trgm` brings into being, and drizzle emits no `CREATE EXTENSION` for
 * it. Exported so a test can assert the split without connecting to anything — the ordering is the
 * contract here, not an implementation detail.
 *
 * Extensions first because a role grant cannot depend on an operator class while an index can, so the
 * order that works either way is the one with no edge to get wrong later.
 *
 * This phase creates no `vector` extension: there is no pgvector anywhere, including in the history a
 * fresh install replays.
 *
 * @returns the idempotent extension, role creation and grant statements
 */
export function preMigrationStatements(): readonly string[] {
  return [...storeExtensionStatements(), ...storeRoleStatements()];
}

/**
 * Every statement that must run AFTER the generated migration, in the order they must run.
 *
 * The enum values, the triggers and the grants: drizzle generates none of them safely here, and all three
 * need the tables and types to exist. Exported so a test can assert the set without connecting to
 * anything — these are the statements least likely to be read again, so what they are has to be checkable
 * cheaply.
 *
 * The enum statements come FIRST and outside the migrator's transaction, which is the whole reason they
 * are here: `ALTER TYPE … ADD VALUE` inside that transaction is what the `drizzle-migrations` safety gate
 * refuses, and its own header names moving it into the apply loop as the way through. See
 * {@link ./policies.enumValueStatements}.
 *
 * @returns the enum, trigger and grant statements, in the order they must run
 */
export function postMigrationStatements(): readonly string[] {
  return [
    ...enumValueStatements(),
    ...SOURCE_ROW_PRESENCE_STATEMENTS,
    ...IMPORT_STAGING_IMMUTABLE_STATEMENTS,
    ...STEER_MEASUREMENT_IMMUTABLE_STATEMENTS,
    ...QUEUE_CHANGE_NOTIFY_STATEMENTS,
    ...storeTableGrantStatements(),
  ];
}

/**
 * Run a list of statements against an open connection, one at a time.
 *
 * Sequential rather than batched so a failure names the statement that failed rather than the block it
 * was in.
 *
 * @param sql the open connection
 * @param statements what to run, in order
 * @param phase the phase name a failure is reported under
 * @returns how many ran, or the first failure with the statement that caused it
 * @internal
 */
async function runStatements({
  sql,
  statements,
  phase,
}: {
  sql: postgres.Sql;
  statements: readonly string[];
  phase: string;
}): Promise<Result<number, StoreError>> {
  let applied = 0;
  for (const statement of statements) {
    try {
      await sql.unsafe(statement);
    } catch (error: unknown) {
      return err(
        StoreErrors.migrationStatementFailed({ detail: firstLineOf({ error }), index: applied + 1, phase, statement }),
      );
    }
    applied += 1;
  }
  return ok(applied);
}

/**
 * What one apply did, so the caller can report it rather than say "done".
 *
 * A count per phase rather than one total, because "the migration applied nothing" and "the guards
 * applied nothing" are different facts and only one of them is normal — the migrator applies nothing on
 * a database that is already current, which is the whole point of the bookkeeping.
 *
 * @internal
 */
export interface ApplyReport {
  /** Role statements run before the migration. */
  readonly roles: number;
  /** Guard statements run after it. */
  readonly guards: number;
  /** Where the migrations were read from. */
  readonly migrationsDir: string;
  /**
   * How many migrations THIS apply recorded, counted under the advisory lock — so of two appliers that both read
   * `behind`, the one that waited reads 0 and does not claim the other's work.
   */
  readonly recorded: number;
}

/**
 * How many migrations the database has recorded, 0 when the bookkeeping table does not exist yet.
 *
 * @param sql the apply's own connection, holding the advisory lock
 * @returns the count, or the read failure
 */
async function countRecorded({ sql }: { sql: postgres.Sql }): Promise<Result<number, StoreError>> {
  try {
    // Two statements, never one `case`: Postgres resolves a relation when it plans the statement, so a branch naming
    // the bookkeeping table fails on a fresh database even when it is the branch not taken.
    const present = await sql<{ present: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
    if (present[0]?.present !== true) {
      return ok(0);
    }
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return ok(rows[0]!.n);
  } catch (error: unknown) {
    return err(StoreErrors.lifecycleReadFailed({ detail: firstLineOf({ error }), subject: "migration-state" }));
  }
}

/**
 * The session-level advisory lock every apply holds from its first statement to its connection's end.
 *
 * Two appliers could otherwise interleave — two `store push` runs, or the door catching a
 * `behind` store up from every verb that opens it at once (`./catchUp.ts`). Held, the second waits; then the
 * migrator applies only entries newer than the last recorded one and the role and guard phases are idempotent,
 * so it applies nothing, and {@link ApplyReport.recorded} says 0. Released by `sql.end`, which closes the one
 * session holding it, so no failure path can leave it held. An advisory lock is scoped to the current database by
 * Postgres itself, so two throwaway databases on one server never wait on each other; the key is `hashtext` of a
 * fixed name so it is readable in `pg_locks` beside its purpose.
 */
const APPLY_LOCK_STATEMENT = "select pg_advisory_lock(hashtext('slopweaver:store-apply'))";

/**
 * Apply the roles, the generated migration and the guards to one database.
 *
 * @param url the connection string to apply against
 * @param cwd the tree {@link MIGRATIONS_DIR} is resolved from; defaults to the tree this build lives in, never the operator's cwd
 * @returns what each phase applied, or the first failure with the statement that caused it
 * @internal
 */
export async function applyStore({
  url,
  cwd = installedTreeRoot({ importMetaUrl: import.meta.url }),
}: {
  url: string;
  cwd?: string;
}): Promise<Result<ApplyReport, StoreError>> {
  const migrationsFolder = join(cwd, MIGRATIONS_DIR);
  // `prepare: false` for a Supabase pooler, which runs in transaction mode and refuses prepared
  // statements; `max: 1` because a migration is one connection's worth of work by construction.
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const locked = await runStatements({ phase: "lock", sql, statements: [APPLY_LOCK_STATEMENT] });
    if (locked.isErr()) {
      return err(locked.error);
    }
    const before = await countRecorded({ sql });
    if (before.isErr()) {
      return err(before.error);
    }
    const roles = await runStatements({ phase: "role", sql, statements: preMigrationStatements() });
    if (roles.isErr()) {
      return err(roles.error);
    }

    try {
      await migrate(drizzle(sql), { migrationsFolder });
    } catch (error: unknown) {
      return err(StoreErrors.migrationApplyFailed({ detail: firstLineOf({ error }), folder: migrationsFolder }));
    }

    const guards = await runStatements({ phase: "guard", sql, statements: postMigrationStatements() });
    if (guards.isErr()) {
      return err(guards.error);
    }

    const after = await countRecorded({ sql });
    if (after.isErr()) {
      return err(after.error);
    }
    return ok({
      guards: guards.value,
      migrationsDir: migrationsFolder,
      recorded: after.value - before.value,
      roles: roles.value,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
