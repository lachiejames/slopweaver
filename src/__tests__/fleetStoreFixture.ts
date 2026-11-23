/**
 * An in-memory fleet store for unit tests: the REAL store-backed port (`src/fleet/storePort.ts`) over a `Map`
 * standing in for the `fleet_config`, `fleet_journal` and `fleet_journal_event` rows, with the real legacy-file
 * reads. A seam, not a mock (`.claude/rules/testing.md`): nothing is stubbed out of a module, a plain object of
 * functions is passed where the production one would be.
 *
 * Because the legacy reads are the real file edge, a test that seeds `fleet/config.json` or `fleet/resume.jsonl`
 * under its throwaway home sees exactly what an install with an empty store sees: the first read imports it once.
 * What this cannot prove is anything Postgres decides — the opt-in `integration/fleetStore.test.ts` covers that.
 */
import type { CmuxReviveEvent } from "../cmux/reviveJournal.js";
import { FleetErrors } from "../fleet/errors.js";
import type { FleetJournalEvent } from "../fleet/journal.js";
import type { FleetPort } from "../fleet/port.js";
import { type FleetRows, type FleetStoreSeams, type StoredFleetConfig, storeFleetPort } from "../fleet/storePort.js";
import { readFleetConfigFile, readFleetJournalFile } from "../fleet/storeRows.js";
import { err, ok } from "../lib/result.js";
import type { FleetJournalName } from "../store/schema/fleet.js";

/**
 * One journal's rows: the head's newest sequence, and each entry's stored event (`null` an undecodable line).
 *
 * @internal — reached as {@link MemoryFleetHome.journals}.
 */
export interface MemoryFleetJournal {
  head: number;
  readonly events: (FleetJournalEvent | CmuxReviveEvent | null)[];
}

/**
 * One home's rows.
 *
 * @internal — reached as {@link MemoryFleetStore.homes}.
 */
export interface MemoryFleetHome {
  config: StoredFleetConfig | undefined;
  readonly journals: Map<FleetJournalName, MemoryFleetJournal>;
}

/** The in-memory store: one slot per home, and a count of the connections opened and closed. */
export interface MemoryFleetStore {
  readonly homes: Map<string, MemoryFleetHome>;
  opened: number;
  closed: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for any home
 */
export function memoryFleetStore(): MemoryFleetStore {
  return { closed: 0, homes: new Map(), opened: 0 };
}

/** One home's slot, made empty on first use. */
function slotOf({ home, store }: { home: string; store: MemoryFleetStore }): MemoryFleetHome {
  const existing = store.homes.get(home);
  if (existing !== undefined) {
    return existing;
  }
  const made: MemoryFleetHome = { config: undefined, journals: new Map() };
  store.homes.set(home, made);
  return made;
}

/**
 * The row operations over one home's slot, with the same insert-if-absent, compare-and-set and head-counter
 * semantics the Postgres statements have.
 *
 * @param home which slot this connection addresses
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ home, store }: { home: string; store: MemoryFleetStore }): FleetRows {
  const slot = slotOf({ home, store });
  return {
    append: ({ event, journal }) => {
      const rows = slot.journals.get(journal);
      if (rows === undefined) {
        return Promise.resolve(ok(undefined));
      }
      rows.head += 1;
      rows.events.push(structuredClone(event));
      return Promise.resolve(ok(rows.head));
    },
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    importJournal: ({ imported, journal }) => {
      if (!slot.journals.has(journal)) {
        const events = imported.entries.map((entry) => structuredClone(entry.event));
        slot.journals.set(journal, { events, head: events.length });
      }
      return Promise.resolve(ok(undefined));
    },
    insertConfig: ({ config }) => {
      if (slot.config !== undefined) {
        return Promise.resolve(ok(undefined));
      }
      slot.config = { capacity: config.capacity, revision: 1, schemaVersion: config.schemaVersion };
      return Promise.resolve(ok(slot.config));
    },
    journalHead: ({ journal }) => Promise.resolve(ok(slot.journals.get(journal)?.head)),
    readConfig: () => Promise.resolve(ok(slot.config)),
    tail: ({ journal, keptKinds, keptLimit, limit }) => {
      const events = slot.journals.get(journal)!.events;
      const before = events.slice(0, Math.max(0, events.length - limit));
      const newestOfKind = new Set(
        keptKinds.flatMap((kind) =>
          before.flatMap((event, at) => (event?.kind === kind ? [at] : [])).slice(-keptLimit),
        ),
      );
      const kept = before.filter((_event, at) => newestOfKind.has(at));
      return Promise.resolve(ok(structuredClone([...kept, ...events.slice(-limit)])));
    },
    updateConfig: ({ config, expectedRevision }) => {
      if (slot.config?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      slot.config = { capacity: config.capacity, revision: expectedRevision + 1, schemaVersion: config.schemaVersion };
      return Promise.resolve(ok(slot.config));
    },
  };
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @returns the seams
 */
export function memoryFleetSeams({ store }: { store: MemoryFleetStore }): FleetStoreSeams {
  return {
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ home, store })));
    },
    readConfigFile: readFleetConfigFile,
    readJournalFile: readFleetJournalFile,
  };
}

/**
 * The store-backed port over a fresh in-memory store — the drop-in for `fleetPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect it; a fresh one otherwise
 * @returns the port
 */
export function memoryFleetPort({ store = memoryFleetStore() }: { store?: MemoryFleetStore } = {}): FleetPort {
  return storeFleetPort({ seams: memoryFleetSeams({ store }) });
}

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableFleetPort(): FleetPort {
  const outage = FleetErrors.storeUnavailable({
    doing: "be opened",
    reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
  });
  return {
    appendCmuxReviveEvent: () => Promise.resolve(err(outage)),
    appendResumeEvent: () => Promise.resolve(err(outage)),
    newestCmuxReviveSequence: () => Promise.resolve(err(outage)),
    readCmuxReviveJournal: () => Promise.resolve(err(outage)),
    readConfig: () => Promise.resolve(err(outage)),
    readResumeJournal: () => Promise.resolve(err(outage)),
    writeConfig: () => Promise.resolve(err(outage)),
  };
}
