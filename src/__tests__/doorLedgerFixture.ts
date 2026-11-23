/**
 * An in-memory door ledger for unit tests: the REAL store-backed port (`src/admit/doorStorePort.ts`) over an array
 * standing in for `door_event`, with the same unique import key and the same `seq` order. A seam, not a mock
 * (`.claude/rules/testing.md`).
 *
 * What this cannot prove is anything Postgres decides — the indexes, the window query's SQL — and the opt-in
 * `integration/doorLedgerStore.test.ts` covers that.
 */
import type { DoorLedgerPort } from "../admit/doorLedgerPort.js";
import { DoorStoreErrors, type DoorStoreUnavailableError } from "../admit/doorStoreErrors.js";
import {
  type DoorRows,
  type DoorSourcePresence,
  type DoorStoreSeams,
  storeDoorLedgerPort,
} from "../admit/doorStorePort.js";
import { err, ok } from "../lib/result.js";
import type { NewDoorEventRecord } from "../store/schema/ledgers.js";

/** The in-memory store: the rows in insert order, whether the import ran, and the connections opened and closed. */
export interface MemoryDoorStore {
  readonly rows: NewDoorEventRecord[];
  imported: boolean;
  opened: number;
  closed: number;
  inserts: number;
}

/**
 * A fresh, empty in-memory store, imported (a home with nothing left to import).
 *
 * @returns the store, holding no row
 */
export function memoryDoorStore(): MemoryDoorStore {
  return { closed: 0, imported: true, inserts: 0, opened: 0, rows: [] };
}

/** A row's overridden findings — an unset column is the empty list its database default writes. */
function overriddenOf({ row }: { row: NewDoorEventRecord }): NonNullable<NewDoorEventRecord["overridden"]> {
  if (row.overridden === undefined) {
    return [];
  }
  return row.overridden;
}

/** The row operations over the in-memory store. */
function memoryRows({ store }: { store: MemoryDoorStore }): DoorRows {
  const seqOf = (row: NewDoorEventRecord): number => store.rows.indexOf(row);
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    imported: () => Promise.resolve(ok(store.imported)),
    insert: ({ row }) => {
      store.inserts += 1;
      if (store.rows.some((stored) => stored.importKey === row.importKey)) {
        return Promise.resolve(ok(false));
      }
      store.rows.push(row);
      return Promise.resolve(ok(true));
    },
    readFriction: ({ from, to }) =>
      Promise.resolve(
        ok(
          store.rows
            .filter(
              (row) =>
                row.provenance === "attributed" &&
                row.occurredAt.getTime() >= from.getTime() &&
                row.occurredAt.getTime() <= to.getTime() &&
                (row.status === "hold" || (row.overridden !== undefined && row.overridden.length > 0)),
            )
            .toSorted((a, b) => seqOf(a) - seqOf(b))
            .map((row) => ({
              action: row.action,
              occurredAt: row.occurredAt,
              overridden: overriddenOf({ row }),
              status: row.status,
            })),
        ),
      ),
    readRefusals: ({ limit }) =>
      Promise.resolve(
        ok(
          store.rows
            .filter((row) => row.status === "refused")
            .toReversed()
            .slice(0, limit)
            .map((row) => ({ importKey: row.importKey, record: row.record !== undefined ? row.record : null })),
        ),
      ),
    unfilled: () => Promise.resolve(ok(store.rows.some((row) => row.record === undefined || row.record === null))),
  };
}

/**
 * Seams over an in-memory store, or over one whose every connection refuses with `unreachable`.
 *
 * @param store the rows the port reads and writes
 * @param unreachable when set, every connection refuses with it — a store outage
 * @param source the legacy file's presence, `absent` unless a test says otherwise
 * @returns the seams
 */
export function memoryDoorSeams({
  store,
  unreachable,
  source = { kind: "absent" },
}: {
  store: MemoryDoorStore;
  unreachable?: DoorStoreUnavailableError;
  source?: DoorSourcePresence;
}): DoorStoreSeams {
  let nonce = 0;
  return {
    connect: () => {
      if (unreachable !== undefined) {
        return Promise.resolve(err(unreachable));
      }
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ store })));
    },
    source: () => ({ path: "/fixture/ledgers/door.jsonl", presence: source }),
    writeNonce: () => {
      nonce += 1;
      return `fixture-${String(nonce)}`;
    },
  };
}

/** An in-memory door ledger: the port a verb is handed, and the store a test reads back. */
export interface MemoryDoorLedger {
  readonly port: DoorLedgerPort;
  readonly store: MemoryDoorStore;
  /** Every record written, in order. */
  readonly records: () => readonly Readonly<Record<string, unknown>>[];
  /** Every record as one JSON line each — the shape `door.jsonl` held, for an assertion on its text. */
  readonly text: () => string;
}

/**
 * A fresh in-memory door ledger over the real store-backed port.
 *
 * @returns the ledger, holding no row
 */
export function memoryDoorLedger(): MemoryDoorLedger {
  const store = memoryDoorStore();
  const records = (): readonly Readonly<Record<string, unknown>>[] =>
    store.rows.flatMap((row) => (row.record !== undefined && row.record !== null ? [row.record] : []));
  return {
    port: storeDoorLedgerPort({ seams: memoryDoorSeams({ store }) }),
    records,
    store,
    text: () =>
      records()
        .map((record) => `${JSON.stringify(record)}\n`)
        .join(""),
  };
}

/**
 * A door ledger whose store is down: every write and read refuses with `DOOR_STORE_UNAVAILABLE`.
 *
 * @returns the port
 */
export function unreachableDoorLedger(): DoorLedgerPort {
  return storeDoorLedgerPort({
    seams: memoryDoorSeams({
      store: memoryDoorStore(),
      unreachable: DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: "fixture: the store is down" }),
    }),
  });
}
