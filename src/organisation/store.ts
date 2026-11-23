/**
 * The organisation row's effectful edge: one read and one whole-row write, over an already-open store client.
 *
 * Writes are optimistic, pinned to the revision the writer read, for `owner_profile`'s reason
 * (`../store/profile/client.ts`): a refused write costs one re-read, a lock held by a dead session costs everybody.
 */
import { and, eq } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient } from "../store/client.js";
import { StoreErrors } from "../store/errors.js";
import { ORGANISATION_ID, type OrganisationRow, organisationTable } from "../store/schema/organisation.js";

import { type OrganisationRecord, parseOrganisationRecord, parseStoredMeta } from "./core.js";
import { type OrganisationError, OrganisationErrors } from "./errors.js";

/** The stored organisation, validated, with the revision a writer pins to and when it was last written. */
export interface StoredOrganisation {
  readonly record: OrganisationRecord;
  readonly revision: number;
  readonly updatedAtIso: string;
}

/** A thrown driver error as this domain's boundary variant. */
function queryFailure({ what, cause }: { what: string; cause: unknown }): OrganisationError {
  return OrganisationErrors.queryFailed({ cause: StoreErrors.queryFailed({ cause, what }) });
}

/**
 * Read the one organisation row, or say it has never been written.
 *
 * @param client an open store connection
 * @returns the stored organisation, or `ORG_NOT_CONFIGURED` when there is no row, or the typed refusal
 */
export async function readStoredOrganisation({
  client,
}: {
  client: StoreClient;
}): Promise<Result<StoredOrganisation, OrganisationError>> {
  let rows: OrganisationRow[];
  try {
    rows = await client.db.select().from(organisationTable).where(eq(organisationTable.id, ORGANISATION_ID)).limit(1);
  } catch (error) {
    return err(queryFailure({ cause: error, what: "organisation read" }));
  }
  const row = rows[0];
  if (row === undefined) {
    return err(OrganisationErrors.notConfigured({ missing: "organisation" }));
  }
  return interpretStoredRow({ row });
}

/**
 * Close a client once its read or write has already answered. A close that rejects changes nothing about that answer
 * — the row was read, or the write committed or was refused — so it is not allowed to replace the typed result with
 * a thrown one, which is what an unguarded `await close()` in a `finally` does.
 *
 * @param client the connection to close; only its `close` is used, so a test passes a plain object
 */
export async function closeAfterAnswer({ client }: { client: { close: () => Promise<void> } }): Promise<void> {
  try {
    await client.close();
  } catch {
    // The answer already stands; a connection that would not close cleanly is the pool's to reap.
  }
}

/**
 * Validate one stored row into the organisation it records. The row is input from outside this process, so
 * interpreting it is a boundary too: a value no parser foresaw that throws on being read is a row a hand-edit left
 * wrong, refused as `ORG_INVALID`, never a crash out of the read.
 *
 * @param row the singleton row as the driver returned it
 * @returns the stored organisation, or the typed refusal naming what is wrong with the row
 */
export function interpretStoredRow({ row }: { row: OrganisationRow }): Result<StoredOrganisation, OrganisationError> {
  try {
    const { id: _id, revision, updatedAt, ...stored } = row;
    const record = parseOrganisationRecord({ value: stored });
    if (record.isErr()) {
      return err(record.error);
    }
    const meta = parseStoredMeta({ revision, updatedAt });
    if (meta.isErr()) {
      return err(meta.error);
    }
    return ok({ record: record.value, ...meta.value });
  } catch (error) {
    const reason = error instanceof Error ? error.message : `a thrown ${typeof error}`;
    return err(OrganisationErrors.invalid({ issues: [`the stored row could not be read: ${reason}`] }));
  }
}

/**
 * The revision the stored row carries, read on its own so a writer can replace a row that no longer validates —
 * the repair `ORG_INVALID` names is a fresh `org set`, and it has to be able to pin to something.
 *
 * @param client an open store connection
 * @returns the revision, 0 when there is no row, or the typed refusal
 */
export async function readStoredRevision({
  client,
}: {
  client: StoreClient;
}): Promise<Result<number, OrganisationError>> {
  let rows: { revision: number }[];
  try {
    rows = await client.db
      .select({ revision: organisationTable.revision })
      .from(organisationTable)
      .where(eq(organisationTable.id, ORGANISATION_ID))
      .limit(1);
  } catch (error) {
    return err(queryFailure({ cause: error, what: "organisation revision read" }));
  }
  const row = rows[0];
  if (row === undefined) {
    return ok(0);
  }
  return ok(row.revision);
}

/**
 * Write the whole organisation row: an insert at `expectedRevision` 0, otherwise an update only while the stored
 * revision still matches.
 *
 * @param client an open store connection
 * @param record the validated organisation to store
 * @param expectedRevision the revision the writer read, or 0 to create
 * @returns the revision now stored, or the typed refusal
 */
export async function writeStoredOrganisation({
  client,
  record,
  expectedRevision,
}: {
  client: StoreClient;
  record: OrganisationRecord;
  expectedRevision: number;
}): Promise<Result<number, OrganisationError>> {
  if (expectedRevision === 0) {
    try {
      await client.db.insert(organisationTable).values({ ...record, id: ORGANISATION_ID, revision: 1 });
    } catch (error) {
      return err(queryFailure({ cause: error, what: "organisation create" }));
    }
    return ok(1);
  }
  const next = expectedRevision + 1;
  let updated: { revision: number }[];
  try {
    updated = await client.db
      .update(organisationTable)
      .set({ ...record, revision: next, updatedAt: new Date() })
      .where(and(eq(organisationTable.id, ORGANISATION_ID), eq(organisationTable.revision, expectedRevision)))
      .returning({ revision: organisationTable.revision });
  } catch (error) {
    return err(queryFailure({ cause: error, what: "organisation write" }));
  }
  if (updated.length > 0) {
    return ok(next);
  }
  const current = await readStoredOrganisation({ client });
  if (current.isErr()) {
    return err(current.error);
  }
  return err(OrganisationErrors.conflict({ actual: current.value.revision, expected: expectedRevision }));
}
