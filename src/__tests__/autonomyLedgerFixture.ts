/**
 * An in-memory autonomy ledger for unit tests: the REAL store-backed port (`src/autonomy/storePort.ts`) over an
 * array standing in for `autonomy_event`, with the same uniqueness the Postgres indexes have — one key, one act per
 * id among authority rows — the same `seq` order, and the import gate's two inputs. A seam, not a mock
 * (`.claude/rules/testing.md`).
 *
 * What this cannot prove is anything Postgres decides, and the opt-in `integration/autonomyLedgerStore.test.ts`
 * covers that.
 */
import type { AutonomyLedgerPort } from "../autonomy/port.js";
import { AutonomyStoreErrors } from "../autonomy/storeErrors.js";
import {
  type AutonomyRevisableRows,
  type AutonomyRevisableSeams,
  type AutonomySourcePresence,
  storeAutonomyLedgerPort,
} from "../autonomy/storePort.js";
import { autonomyRecordJson } from "../autonomy/storeRecord.js";
import type { AutonomyRecord } from "../autonomy/types.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, unwrap } from "../lib/result.js";
import type { NewAutonomyEventRecord } from "../store/schema/ledgers.js";

/** The in-memory store: its rows in insert order, the import record, and counts of what was asked of it. */
export interface MemoryAutonomyStore {
  readonly rows: NewAutonomyEventRecord[];
  imported: boolean;
  /** What the home's register file is, while the store holds no import record. */
  source: AutonomySourcePresence;
  opened: number;
  closed: number;
  inserts: number;
}

/**
 * A fresh, empty in-memory store with no register file beside it — a new install.
 *
 * @returns the store, holding no row
 */
export function memoryAutonomyStore(): MemoryAutonomyStore {
  return { closed: 0, imported: false, inserts: 0, opened: 0, rows: [], source: { kind: "absent" } };
}

/** Whether a row would collide with one already stored, on any of the table's unique indexes. */
function collides({ row, rows }: { row: NewAutonomyEventRecord; rows: readonly NewAutonomyEventRecord[] }): boolean {
  return rows.some(
    (stored) =>
      stored.importKey === row.importKey ||
      (row.entryKind === "action" &&
        stored.entryKind === "action" &&
        stored.actionId === row.actionId &&
        stored.record != null &&
        row.record != null),
  );
}

/** The row operations over the in-memory store. */
function memoryRows({ store }: { store: MemoryAutonomyStore }): AutonomyRevisableRows {
  const authority = (): NewAutonomyEventRecord[] => store.rows.filter((row) => row.record != null);
  return {
    revise: ({ actionId, expected, row }) => {
      const index = store.rows.findIndex(
        (stored) =>
          stored.entryKind === "action" &&
          stored.actionId === actionId &&
          isRecord(stored.record) &&
          autonomyRecordJson({ record: stored.record }) === autonomyRecordJson({ record: expected }),
      );
      if (index === -1) {
        return Promise.resolve(ok(false));
      }
      store.rows[index] = { ...store.rows[index]!, record: row.record, why: row.why, witness: row.witness };
      return Promise.resolve(ok(true));
    },
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    imported: () => Promise.resolve(ok(store.imported)),
    insert: ({ row }) => {
      store.inserts += 1;
      if (collides({ row, rows: store.rows })) {
        return Promise.resolve(ok(false));
      }
      store.rows.push(row);
      return Promise.resolve(ok(true));
    },
    readAction: ({ actionId }) => {
      const held = authority().find((row) => row.entryKind === "action" && row.actionId === actionId);
      if (held === undefined) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(ok({ importKey: held.importKey, record: held.record }));
    },
    readAll: () => Promise.resolve(ok(authority().map((row) => ({ importKey: row.importKey, record: row.record })))),
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `autonomyLedgerPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect or seed it; a fresh one otherwise
 * @returns the port
 */
export function memoryAutonomyLedgerPort({
  store = memoryAutonomyStore(),
}: { store?: MemoryAutonomyStore } = {}): AutonomyLedgerPort {
  return storeAutonomyLedgerPort({ seams: memoryAutonomySeams({ store }) });
}

/**
 * The store seams over an in-memory store, their connection offering the one in-place revision — what a test of
 * `autonomy qualify`'s repair drives, beside a port over the SAME store that seeds and reads it back.
 *
 * @param store the in-memory store both the seams and any port over it share
 * @returns the seams
 */
export function memoryAutonomySeams({ store }: { store: MemoryAutonomyStore }): AutonomyRevisableSeams {
  let handed = 0;
  return {
    connect: () => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ store })));
    },
    source: () => ({ path: "/fixture-home/ledgers/autonomy.jsonl", presence: store.source }),
    steerNonce: () => {
      handed += 1;
      return `nonce-${String(handed)}`;
    },
  };
}

/** The outage every operation of {@link unavailableAutonomyLedgerPort} refuses with. */
export const AUTONOMY_FIXTURE_OUTAGE = AutonomyStoreErrors.storeUnavailable({
  doing: "be opened",
  reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
});

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableAutonomyLedgerPort(): AutonomyLedgerPort {
  return storeAutonomyLedgerPort({
    seams: {
      connect: () => Promise.resolve(err(AUTONOMY_FIXTURE_OUTAGE)),
      source: () => ({ path: "/fixture-home/ledgers/autonomy.jsonl", presence: { kind: "absent" } }),
      steerNonce: () => "unused",
    },
  });
}

/**
 * Every record a port holds, for a test asserting what a verb wrote. Throws on a refusal, so a test cannot read
 * an outage as an empty ledger.
 *
 * @param port the port the verb under test was handed
 * @returns the records, in write order
 */
export async function heldAutonomyRecords({ port }: { port: AutonomyLedgerPort }): Promise<readonly AutonomyRecord[]> {
  return unwrap(await port.readRecords({ home: "/fixture-home" }));
}

/**
 * Write records through a port before a test runs, throwing on any refusal.
 *
 * @param port the port to seed
 * @param records the records, written in order
 */
export async function seedAutonomyRecords({
  port,
  records,
}: {
  port: AutonomyLedgerPort;
  records: readonly AutonomyRecord[];
}): Promise<void> {
  for (const record of records) {
    unwrap(await port.appendRecord({ home: "/fixture-home", record }));
  }
}
