/**
 * The Postgres half of the store-backed autonomy ledger: open the store, read `autonomy_event`'s authority rows in
 * `seq` order, read one act, read the import record, and insert one row. `./storePort.ts` owns every decision;
 * this module only speaks SQL, plus the one `stat` of the home's register file the import gate needs.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote host
 * and a database whose migrations this checkout does not carry — and every failure becomes
 * `AUTONOMY_STORE_UNAVAILABLE`, never an empty answer. The insert is an UNTARGETED `ON CONFLICT DO NOTHING ...
 * RETURNING`, so a collision on the key or on the one-act-per-id partial index answers `false` rather than
 * overwriting the winner.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import { isAbsentError, isNotFoundError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import {
  AUTONOMY_REGISTER_ID,
  autonomyEventTable,
  autonomyRegisterTable,
  type NewAutonomyEventRecord,
} from "../store/schema/ledgers.js";
import { AutonomyStoreErrors, type AutonomyStoreUnavailableError } from "./storeErrors.js";
import type {
  AutonomyRevisableRows,
  AutonomyRevisableSeams,
  AutonomySourcePresence,
  StoredAutonomyRow,
} from "./storePort.js";
import { autonomyRecordJson, boundAutonomyEventRow } from "./storeRecord.js";

/** Run one statement, turning a throw into the typed store refusal. */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, AutonomyStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    return err(AutonomyStoreErrors.storeUnavailable({ doing, reason }));
  }
}

/** The compare-and-swap UPDATE behind `revise`: one act's row replaced only while its record still equals `expected`. */
async function reviseAct({
  client,
  actionId,
  expected,
  row,
}: { client: StoreClient } & Parameters<AutonomyRevisableRows["revise"]>[0]): ReturnType<
  AutonomyRevisableRows["revise"]
> {
  return attempt({
    doing: "revise the act stored under one id",
    statement: async () => {
      const revised = await client.db
        .update(autonomyEventTable)
        .set({
          record: sql`cast(${autonomyRecordJson({ record: row.record })} as text)::jsonb`,
          why: row.why,
          witness: row.witness,
        })
        .where(
          and(
            eq(autonomyEventTable.actionId, actionId),
            eq(autonomyEventTable.entryKind, "action"),
            // jsonb's canonical TEXT, not jsonb equality: `1` and `1.0` are equal jsonb but print apart, and
            // a stored value JS could not round-trip must refuse the revision rather than be rewritten.
            sql`${autonomyEventTable.record}::text = (cast(${autonomyRecordJson({ record: expected })} as text)::jsonb)::text`,
          ),
        )
        .returning({ id: autonomyEventTable.id });
      return revised.length === 1;
    },
  });
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function autonomyRowsOver({ client }: { client: StoreClient }): AutonomyRevisableRows {
  return {
    close: () => client.close(),
    imported: () =>
      attempt({
        doing: "read whether the autonomy register was imported",
        statement: async () => {
          const rows = await client.db
            .select({ id: autonomyRegisterTable.id })
            .from(autonomyRegisterTable)
            .where(eq(autonomyRegisterTable.id, AUTONOMY_REGISTER_ID));
          return rows.length > 0;
        },
      }),
    insert: ({ row }: { row: NewAutonomyEventRecord }) =>
      attempt({
        doing: "record the autonomy ledger row",
        statement: async () => {
          const inserted = await client.db
            .insert(autonomyEventTable)
            .values(boundAutonomyEventRow({ row }))
            .onConflictDoNothing()
            .returning({ id: autonomyEventTable.id });
          return inserted.length > 0;
        },
      }),
    readAction: ({ actionId }: { actionId: string }) =>
      attempt({
        doing: "read the act stored under one id",
        statement: async (): Promise<StoredAutonomyRow | undefined> => {
          const rows = await client.db
            .select({ importKey: autonomyEventTable.importKey, record: autonomyEventTable.record })
            .from(autonomyEventTable)
            .where(
              and(
                eq(autonomyEventTable.actionId, actionId),
                eq(autonomyEventTable.entryKind, "action"),
                isNotNull(autonomyEventTable.record),
              ),
            )
            .limit(1);
          return rows[0];
        },
      }),
    revise: (request) => reviseAct({ ...request, client }),
    readAll: () =>
      attempt({
        doing: "read the autonomy ledger",
        statement: async (): Promise<readonly StoredAutonomyRow[]> =>
          client.db
            .select({ importKey: autonomyEventTable.importKey, record: autonomyEventTable.record })
            .from(autonomyEventTable)
            .where(isNotNull(autonomyEventTable.record))
            .orderBy(asc(autonomyEventTable.seq)),
      }),
  };
}

/** Open the store a home selects, as the autonomy ledger's row operations. */
async function connectAutonomyRows({
  home,
}: {
  home: string;
}): Promise<Result<AutonomyRevisableRows, AutonomyStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(AutonomyStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(autonomyRowsOver({ client: client.value }));
}

/**
 * Whether a file is there. `existsSync` swallows every error as `false`, so a register whose directory cannot be
 * traversed would read as a fresh install; only an ENOENT with nothing standing on the way means absent here, so
 * a dangling symlink at the register or any directory above it is unknown, never a fresh register.
 *
 * @param path the register file
 * @returns present, absent, or the reason it could not be told
 */
export function filePresence({ path }: { path: string }): AutonomySourcePresence {
  try {
    statSync(path);
    return { kind: "present" };
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return { kind: "absent" };
    }
    if (isNotFoundError({ error })) {
      return { kind: "unknown", reason: `${path} is behind a dangling symlink` };
    }
    return { kind: "unknown", reason: error instanceof Error ? error.message : "the stat failed" };
  }
}

/**
 * The production seams: the real store, the home's register file, and a random steer nonce.
 *
 * @returns the seams `autonomyLedgerPort()` runs over
 */
export function productionAutonomyStoreSeams(): AutonomyRevisableSeams {
  return {
    connect: connectAutonomyRows,
    source: ({ home }) => {
      const path = stateHomePaths({ home }).autonomyLedgerJsonl;
      return { path, presence: filePresence({ path }) };
    },
    steerNonce: () => randomUUID(),
  };
}
