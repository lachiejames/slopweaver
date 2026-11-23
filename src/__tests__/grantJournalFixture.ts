/**
 * An in-memory grant journal for unit tests: the REAL store-backed port (`src/grants/storePort.ts`) over an array
 * standing in for `grant_row`, with the same uniqueness the Postgres indexes have — one import key, one grant and
 * one performance per grant id — and the same `seq` order. A seam, not a mock (`.claude/rules/testing.md`).
 *
 * What this cannot prove is anything Postgres decides, and the opt-in `integration/grantJournalStore.test.ts`
 * covers that.
 */
import type { GrantJournalPort } from "../grants/port.js";
import { GrantStoreErrors } from "../grants/storeErrors.js";
import { type GrantRows, type GrantStoreSeams, storeGrantJournalPort } from "../grants/storePort.js";
import { err, ok } from "../lib/result.js";
import type { NewGrantRowRecord } from "../store/schema/ledgers.js";

/** The in-memory store: the rows in insert order, and a count of the connections opened, closed and inserts tried. */
export interface MemoryGrantStore {
  readonly rows: NewGrantRowRecord[];
  opened: number;
  closed: number;
  inserts: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row
 */
export function memoryGrantStore(): MemoryGrantStore {
  return { closed: 0, inserts: 0, opened: 0, rows: [] };
}

/** Whether a row would collide with one already stored, on any of the table's unique indexes. */
function collides({ row, rows }: { row: NewGrantRowRecord; rows: readonly NewGrantRowRecord[] }): boolean {
  return rows.some(
    (stored) =>
      stored.importKey === row.importKey ||
      (stored.grantId === row.grantId &&
        stored.entryKind === row.entryKind &&
        (row.entryKind === "grant" || row.entryKind === "performance")),
  );
}

/** The row operations over the in-memory store. */
function memoryRows({ store }: { store: MemoryGrantStore }): GrantRows {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ row }) => {
      store.inserts += 1;
      if (collides({ row, rows: store.rows })) {
        return Promise.resolve(ok(false));
      }
      store.rows.push(row);
      return Promise.resolve(ok(true));
    },
    readAll: () => Promise.resolve(ok(store.rows.map((row) => ({ entry: row.entry, importKey: row.importKey })))),
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `grantJournalPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect or seed it; a fresh one otherwise
 * @param nonces the refusal nonces to hand out, in order; a counter otherwise
 * @returns the port
 */
export function memoryGrantJournalPort({
  store = memoryGrantStore(),
  nonces = [],
}: { store?: MemoryGrantStore; nonces?: readonly string[] } = {}): GrantJournalPort {
  let handed = 0;
  const seams: GrantStoreSeams = {
    connect: () => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ store })));
    },
    refusalNonce: () => {
      const nonce = nonces[handed];
      handed += 1;
      if (nonce === undefined) {
        return `nonce-${String(handed)}`;
      }
      return nonce;
    },
  };
  return storeGrantJournalPort({ seams });
}

/** The outage every operation of {@link unavailableGrantJournalPort} refuses with. */
export const GRANT_FIXTURE_OUTAGE = GrantStoreErrors.storeUnavailable({
  doing: "be opened",
  reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
});

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableGrantJournalPort(): GrantJournalPort {
  return storeGrantJournalPort({
    seams: { connect: () => Promise.resolve(err(GRANT_FIXTURE_OUTAGE)), refusalNonce: () => "unused" },
  });
}
