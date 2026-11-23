/**
 * The Postgres half of the store-backed door ledger: open the store, read the import record, ask whether a mirror
 * row is still unfilled, insert one row, and read the two shapes a reader wants. `./doorStorePort.ts` owns every
 * decision; this module only speaks SQL, plus the one `stat` of the home's old file the import gate needs.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote host
 * and a database whose migrations this checkout does not carry — and every failure becomes
 * `DOOR_STORE_UNAVAILABLE`, never an empty answer. The insert is an UNTARGETED `ON CONFLICT DO NOTHING ...
 * RETURNING`, so a collision answers `false` rather than overwriting the winner.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { and, asc, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { filePresence } from "../autonomy/storeRows.js";
import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import {
  DOOR_REGISTER_ID,
  doorEventTable,
  doorRegisterTable,
  type NewDoorEventRecord,
} from "../store/schema/ledgers.js";
import { DoorStoreErrors, type DoorStoreUnavailableError } from "./doorStoreErrors.js";
import type { DoorRows, DoorStoreSeams, StoredDoorFriction, StoredDoorRecord } from "./doorStorePort.js";

/** Run one statement, turning a throw into the typed store refusal. */
async function attempt<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, DoorStoreUnavailableError>> {
  try {
    return ok(await statement());
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown failure";
    return err(DoorStoreErrors.storeUnavailable({ doing, reason }));
  }
}

/** The attributed holds and overridden decisions inside a window, oldest first. */
async function selectFriction({
  client,
  from,
  to,
}: {
  client: StoreClient;
  from: Date;
  to: Date;
}): Promise<readonly StoredDoorFriction[]> {
  return client.db
    .select({
      action: doorEventTable.action,
      occurredAt: doorEventTable.occurredAt,
      overridden: doorEventTable.overridden,
      status: doorEventTable.status,
    })
    .from(doorEventTable)
    .where(
      and(
        eq(doorEventTable.provenance, "attributed"),
        gte(doorEventTable.occurredAt, from),
        lte(doorEventTable.occurredAt, to),
        or(eq(doorEventTable.status, "hold"), gt(sql`jsonb_array_length(${doorEventTable.overridden})`, 0)),
      ),
    )
    .orderBy(asc(doorEventTable.seq));
}

/** The newest pre-door refusals, newest first. */
async function selectRefusals({
  client,
  limit,
}: {
  client: StoreClient;
  limit: number;
}): Promise<readonly StoredDoorRecord[]> {
  return client.db
    .select({ importKey: doorEventTable.importKey, record: doorEventTable.record })
    .from(doorEventTable)
    .where(eq(doorEventTable.status, "refused"))
    .orderBy(desc(doorEventTable.seq))
    .limit(limit);
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function doorRowsOver({ client }: { client: StoreClient }): DoorRows {
  return {
    close: () => client.close(),
    imported: () =>
      attempt({
        doing: "read whether the door ledger was imported",
        statement: async () => {
          const rows = await client.db
            .select({ id: doorRegisterTable.id })
            .from(doorRegisterTable)
            .where(eq(doorRegisterTable.id, DOOR_REGISTER_ID));
          return rows.length > 0;
        },
      }),
    insert: ({ row }: { row: NewDoorEventRecord }) =>
      attempt({
        doing: "record the door decision",
        statement: async () => {
          const inserted = await client.db
            .insert(doorEventTable)
            .values(row)
            .onConflictDoNothing()
            .returning({ id: doorEventTable.id });
          return inserted.length > 0;
        },
      }),
    readFriction: ({ from, to }: { from: Date; to: Date }) =>
      attempt({
        doing: "read the door's holds and overrides",
        statement: () => selectFriction({ client, from, to }),
      }),
    readRefusals: ({ limit }: { limit: number }) =>
      attempt({
        doing: "read the pre-door refusals",
        statement: () => selectRefusals({ client, limit }),
      }),
    unfilled: () =>
      attempt({
        doing: "read whether every door row carries its record",
        statement: async () => {
          const rows = await client.db
            .select({ id: doorEventTable.id })
            .from(doorEventTable)
            .where(isNull(doorEventTable.record))
            .limit(1);
          return rows.length > 0;
        },
      }),
  };
}

/** Open the store a home selects, as the door ledger's row operations. */
async function connectDoorRows({ home }: { home: string }): Promise<Result<DoorRows, DoorStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(doorRowsOver({ client: client.value }));
}

/** Where a home's `ledgers/door.jsonl` is — the source of the one-time import, and read by nothing else. */
function doorImportSourcePath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "door.jsonl");
}

/**
 * The production seams: the real store, the home's legacy ledger file, and a random write nonce.
 *
 * @returns the seams `doorLedgerPort()` runs over
 */
export function productionDoorStoreSeams(): DoorStoreSeams {
  return {
    connect: connectDoorRows,
    source: ({ home }) => {
      const path = doorImportSourcePath({ home });
      return { path, presence: filePresence({ path }) };
    },
    writeNonce: () => randomUUID(),
  };
}
