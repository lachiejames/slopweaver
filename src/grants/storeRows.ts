/**
 * The Postgres half of the store-backed grant journal: open the store, read `grant_row` in `seq` order, and insert
 * one row. `./storePort.ts` owns every decision; this module only speaks SQL.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote host
 * and a database whose migrations this checkout does not carry — and every failure becomes
 * `GRANT_STORE_UNAVAILABLE`, never an empty answer. The insert is an UNTARGETED `ON CONFLICT DO NOTHING ...
 * RETURNING`, so a collision on the import key or on either one-per-grant partial index answers `false` rather than
 * overwriting the winner.
 */
import { randomUUID } from "node:crypto";

import { asc } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../store/client.js";
import { grantRowTable, type NewGrantRowRecord } from "../store/schema/ledgers.js";
import { GrantStoreErrors, type GrantStoreUnavailableError } from "./storeErrors.js";
import type { GrantRows, GrantStoreSeams, StoredGrantRow } from "./storePort.js";

/** Run one statement, turning a throw into the typed store refusal. */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, GrantStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    return err(GrantStoreErrors.storeUnavailable({ doing, reason }));
  }
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function grantRowsOver({ client }: { client: StoreClient }): GrantRows {
  return {
    close: () => client.close(),
    insert: ({ row }: { row: NewGrantRowRecord }) =>
      attempt({
        doing: "record the grant journal entry",
        statement: async () => {
          const inserted = await client.db
            .insert(grantRowTable)
            .values(row)
            .onConflictDoNothing()
            .returning({ id: grantRowTable.id });
          return inserted.length > 0;
        },
      }),
    readAll: () =>
      attempt({
        doing: "read the grant journal",
        statement: async (): Promise<readonly StoredGrantRow[]> =>
          client.db
            .select({ entry: grantRowTable.entry, importKey: grantRowTable.importKey })
            .from(grantRowTable)
            .orderBy(asc(grantRowTable.seq)),
      }),
  };
}

/** Open the store a home selects, as the grant journal's row operations. */
async function connectGrantRows({ home }: { home: string }): Promise<Result<GrantRows, GrantStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(GrantStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(grantRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store, and a random refusal nonce.
 *
 * @returns the seams `grantJournalPort()` runs over
 */
export function productionGrantStoreSeams(): GrantStoreSeams {
  return { connect: connectGrantRows, refusalNonce: () => randomUUID() };
}
