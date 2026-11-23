/**
 * The PURE decisions a restore makes about its target: which shape of replay it needs, which table-of-contents
 * entries it may replay, and how a restored copy's row counts compare with the live store's.
 *
 * Split from `./plan.ts`, which names and shapes a backup, because these are the restore side's decisions over
 * an existing database rather than anything a backup writes, and the one file holding both grew past the size
 * ratchet.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";

/** One table's row count on one side of a comparison. */
export interface TableCount {
  readonly table: string;
  readonly rows: number;
}

/** What comparing a restored database to the live one found, table by table. */
export interface CountComparison {
  readonly identical: boolean;
  /** Every table either side has, with both counts; `null` where a side lacks the table. */
  readonly tables: readonly { table: string; live: number | null; restored: number | null }[];
}

/**
 * Compare per-table row counts on the live and restored sides.
 *
 * A table missing from either side is a difference, never skipped: a restore that silently drops an
 * empty table would otherwise compare identical.
 *
 * @param live the live database's counts
 * @param restored the restored database's counts
 * @returns whether every table matches, and the whole table for the report
 */
export function compareCounts({
  live,
  restored,
}: {
  live: readonly TableCount[];
  restored: readonly TableCount[];
}): CountComparison {
  const names = [...new Set([...live.map((row) => row.table), ...restored.map((row) => row.table)])].toSorted();
  const tables = names.map((table) => {
    // A table present on one side and not the other is the finding a comparison exists to surface, so the
    // missing side is reported as `null` by a branch that names it rather than coalesced into one.
    const liveRow = live.find((row) => row.table === table);
    const restoredRow = restored.find((row) => row.table === table);
    return {
      live: liveRow === undefined ? null : liveRow.rows,
      restored: restoredRow === undefined ? null : restoredRow.rows,
      table,
    };
  });
  return { identical: tables.every((row) => row.live !== null && row.live === row.restored), tables };
}

/**
 * Filter a `pg_restore -l` table of contents down to what a restore may replay onto the target.
 *
 * The one entry always dropped is `SCHEMA - public`: every Postgres database already has a `public`
 * schema, and a `-n public` dump carries a `CREATE SCHEMA public` that fails on any of them. Dropping the
 * schema first is not an option because the extensions the tables need are created INTO it before the
 * restore runs. Comment lines (`;`) are kept — `pg_restore -L` ignores them.
 *
 * @param toc the listing, one entry per line
 * @returns the lines to hand back as the `-L` list
 */
export function filterRestoreToc({ toc }: { toc: string }): readonly string[] {
  return toc.split("\n").filter((line) => !/^\d+; \d+ \d+ SCHEMA - public\b/.test(line));
}

/** Which restore shape a target needs, decided by what already stands in it. */
export type RestoreMode =
  /** An empty database — created here, or created empty by hand. Plain replay. */
  | "empty"
  /** A fresh `yarn store:start` database: `storage` already exists, so each object is dropped and re-created. */
  | "stack";

/**
 * Decide whether a target can be restored into, and how.
 *
 * A database whose `public` schema already holds a table is refused: it is a store, and a restore never
 * writes over one. A target with the `storage` schema is a Supabase database, whose Storage API has
 * already created its tables — those are dropped and re-created from the dump (`--clean --if-exists`),
 * which is what puts the backup's buckets and objects where the running Storage API will read them.
 *
 * @param publicTables how many tables the target's `public` schema has
 * @param hasStorageSchema whether the target has a `storage` schema at all
 * @returns the mode, or the refusal
 */
export function restoreModeFor({
  publicTables,
  hasStorageSchema,
}: {
  publicTables: number;
  hasStorageSchema: boolean;
}): Result<RestoreMode, BackupError> {
  if (publicTables > 0) {
    return err(BackupErrors.restoreTargetNotEmpty({ publicTables }));
  }
  return ok(hasStorageSchema ? "stack" : "empty");
}
