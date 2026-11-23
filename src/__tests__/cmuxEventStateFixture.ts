/**
 * An in-memory cmux event state store for unit tests: the REAL store-backed port (`src/cmux/eventState/storePort.ts`)
 * over a `Map` standing in for the `cmux_event_state` rows, with the real import-file read. A seam, not a mock
 * (`.claude/rules/testing.md`): nothing is stubbed out of a module, a plain object of functions is passed where the
 * production one would be.
 *
 * Because the import read is the real file edge, a test that seeds the two retired files under its throwaway home
 * sees exactly what an install with an empty store sees. What this cannot prove is anything Postgres decides — the
 * opt-in `integration/cmuxEventStateStore.test.ts` covers that.
 */
import { type CmuxEventConsumer, CmuxEventStateErrors } from "../cmux/eventState/errors.js";
import type { CmuxEventStatePort } from "../cmux/eventState/port.js";
import {
  type CmuxEventStateRows,
  type CmuxEventStateSeams,
  type StoredCmuxEventState,
  storeCmuxEventStatePort,
} from "../cmux/eventState/storePort.js";
import { readCmuxEventImportText } from "../cmux/eventState/storeRows.js";
import { err, ok } from "../lib/result.js";

/** The in-memory store: one row per consumer, and a count of the connections opened and closed. */
export interface MemoryCmuxEventStateStore {
  readonly rows: Map<CmuxEventConsumer, StoredCmuxEventState>;
  opened: number;
  closed: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for either consumer
 */
export function memoryCmuxEventStateStore(): MemoryCmuxEventStateStore {
  return { closed: 0, opened: 0, rows: new Map() };
}

/**
 * The row operations over the in-memory store, with the same insert-if-absent and compare-and-set semantics the
 * Postgres statements have.
 *
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ store }: { store: MemoryCmuxEventStateStore }): CmuxEventStateRows {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ activities, consumer, cursorSeq }) => {
      if (store.rows.has(consumer)) {
        return Promise.resolve(ok(undefined));
      }
      const row = { activities: structuredClone(activities), cursorSeq, revision: 1 };
      store.rows.set(consumer, row);
      return Promise.resolve(ok(row));
    },
    read: ({ consumer }) => Promise.resolve(ok(store.rows.get(consumer))),
    update: ({ activities, consumer, cursorSeq, expectedRevision }) => {
      const current = store.rows.get(consumer);
      if (current?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      const row = { activities: structuredClone(activities), cursorSeq, revision: expectedRevision + 1 };
      store.rows.set(consumer, row);
      return Promise.resolve(ok(row));
    },
  };
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @returns the seams
 */
export function memoryCmuxEventStateSeams({ store }: { store: MemoryCmuxEventStateStore }): CmuxEventStateSeams {
  return {
    connect: () => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ store })));
    },
    readImportText: readCmuxEventImportText,
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `cmuxEventStatePort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect it; a fresh one otherwise
 * @returns the port
 */
export function memoryCmuxEventStatePort({
  store = memoryCmuxEventStateStore(),
}: { store?: MemoryCmuxEventStateStore } = {}): CmuxEventStatePort {
  return storeCmuxEventStatePort({ seams: memoryCmuxEventStateSeams({ store }) });
}

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableCmuxEventStatePort(): CmuxEventStatePort {
  const outage = CmuxEventStateErrors.storeUnavailable({
    doing: "be opened",
    reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
  });
  return {
    readEventsCursor: () => Promise.resolve(err(outage)),
    readSessionWatch: () => Promise.resolve(err(outage)),
    resetSessionWatch: () => Promise.resolve(err(outage)),
    writeEventsCursor: () => Promise.resolve(err(outage)),
    writeSessionWatch: () => Promise.resolve(err(outage)),
  };
}
