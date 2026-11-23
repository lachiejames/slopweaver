/**
 * The two checks every staging and answering transaction opens with, before it reads or writes a staging table:
 * resolve the real tables, never a session's temporary ones, and refuse a store whose staging guards are not all
 * installed and enabled ALWAYS.
 */
import { sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../client.js";
import { missingStagingTriggers } from "../schema/importStaging.js";
import { STEER_MEASUREMENT_TRIGGERS } from "../schema/steerMeasurements.js";

import { type ImportGuardsMissingError, type StoreImportError, StoreImportErrors } from "./importErrors.js";

/**
 * Put the session's temporary schema LAST for the rest of the caller's transaction. Drizzle names a table without a
 * schema, and Postgres searches `pg_temp` first unless the path lists it, so a temporary table of a staging table's
 * name on this session would be read and written in its place — a forged batch reported already staged.
 *
 * @param writer the open transaction the path is set for, until it ends
 */
export async function realTablesOnly({ writer }: { writer: StoreWriter }): Promise<void> {
  await writer.execute(sql`set local search_path = pg_catalog, public, pg_temp`);
}

/**
 * `IMPORT_GUARDS_MISSING` when a staging trigger is absent or not enabled ALWAYS, as an apply that committed the
 * migration and never reached its guard phase leaves the store; checked inside the writing transaction, before
 * anything is written. Only `A` counts: an origin-mode trigger (`O`) does not fire for a replica-mode session.
 *
 * @param writer the open transaction about to write
 * @returns `null` when every staging trigger on the public tables is there and enabled ALWAYS, else the refusal
 */
export async function stagingGuardsInstalled({
  writer,
}: {
  writer: StoreWriter;
}): Promise<Result<null, StoreImportError>> {
  const missing = missingStagingTriggers({ installed: await alwaysTriggers({ writer }) });
  if (missing.length > 0) {
    return err(StoreImportErrors.guardsMissing({ missing }));
  }
  return ok(null);
}

/** Every trigger on a public table enabled ALWAYS, by table and name. */
async function alwaysTriggers({
  writer,
}: {
  writer: StoreWriter;
}): Promise<readonly { table: string; name: string }[]> {
  return writer.execute<{ table: string; name: string }>(
    sql`select c.relname as "table", t.tgname as "name" from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled = 'A'`,
  );
}

/**
 * `IMPORT_GUARDS_MISSING` for an apply: every staging trigger, and the steer-measurement table's own append-only
 * triggers, since an apply appends to that table, present and enabled ALWAYS.
 *
 * @param writer the apply's open transaction
 * @returns `null` when every guard is there and enabled ALWAYS, else the refusal naming each one missing
 */
export async function applyGuardsInstalled({
  writer,
}: {
  writer: StoreWriter;
}): Promise<Result<null, ImportGuardsMissingError>> {
  const installed = await alwaysTriggers({ writer });
  const present = new Set(installed.map((trigger) => `${trigger.table}.${trigger.name}`));
  const missing = [
    ...missingStagingTriggers({ installed }),
    ...STEER_MEASUREMENT_TRIGGERS.filter((trigger) => !present.has(`${trigger.table}.${trigger.name}`)).map(
      (trigger) => trigger.name,
    ),
  ];
  if (missing.length > 0) {
    return err(StoreImportErrors.guardsMissing({ missing }));
  }
  return ok(null);
}
