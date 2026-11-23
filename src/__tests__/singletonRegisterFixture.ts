/**
 * An in-memory store for the singleton registers, for unit tests: the REAL orchestration
 * (`src/store/singletonRegister.ts`) over a `Map` standing in for each home's row, with the same insert-if-absent
 * and compare-and-set semantics the Postgres statements have. A seam, not a mock (`.claude/rules/testing.md`):
 * nothing is stubbed out of a module, a plain object of functions is passed where the production one would be.
 *
 * Each domain's own fixture (`memory…Port()` / `unavailable…Port()`) builds on {@link memorySingletonRegisterSeams}
 * with its real file read and decoder, so a test that seeds the retired file under its throwaway home sees exactly
 * what an install with an empty store sees. What only Postgres decides is the opt-in integration proof.
 */
import { err, ok } from "../lib/result.js";
import type {
  SingletonRegisterRows,
  SingletonRegisterSeams,
  StoredSingletonRegister,
} from "../store/singletonRegister.js";

/** The in-memory store: one row per home, and counts of the connections opened and closed. */
export interface MemorySingletonStore {
  readonly rows: Map<string, StoredSingletonRegister>;
  opened: number;
  closed: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for any home
 */
export function memorySingletonStore(): MemorySingletonStore {
  return { closed: 0, opened: 0, rows: new Map() };
}

/**
 * The row operations over one home's slot, with the Postgres statements' semantics — insert-if-absent and a
 * compare-and-set that bumps the revision. Shared with `./planRegisterFixture.ts`, whose row has the same shape.
 *
 * @param home which row this connection addresses
 * @returns the operations
 */
export function memoryRevisionRows<Failure>({
  home,
  store,
}: {
  home: string;
  store: MemorySingletonStore;
}): SingletonRegisterRows<Failure> {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ document }) => {
      if (store.rows.has(home)) {
        return Promise.resolve(ok(undefined));
      }
      const row = { document: structuredClone(document), revision: 1 };
      store.rows.set(home, row);
      return Promise.resolve(ok(row));
    },
    read: () => Promise.resolve(ok(store.rows.get(home))),
    update: ({ document, expectedRevision }) => {
      const current = store.rows.get(home);
      if (current?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      const row = { document: structuredClone(document), revision: expectedRevision + 1 };
      store.rows.set(home, row);
      return Promise.resolve(ok(row));
    },
  };
}

/**
 * The domain's seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @param readImport the domain's real retired-file read
 * @param decodeStored the domain's real decoder
 * @param errors the domain's real failure factories
 * @returns the seams
 */
export function memorySingletonRegisterSeams<Document, Failure>({
  decodeStored,
  errors,
  readImport,
  store,
}: {
  decodeStored: SingletonRegisterSeams<Document, Failure>["decodeStored"];
  errors: SingletonRegisterSeams<Document, Failure>["errors"];
  readImport: SingletonRegisterSeams<Document, Failure>["readImport"];
  store: MemorySingletonStore;
}): SingletonRegisterSeams<Document, Failure> {
  return {
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRevisionRows<Failure>({ home, store })));
    },
    decodeStored,
    errors,
    readImport,
  };
}

/** The reason every fixture outage carries, so a test can assert it reached the message. */
export const FIXTURE_OUTAGE_REASON = "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)";

/**
 * The domain's seams over a store that cannot be opened: every connect answers the domain's own outage, with
 * {@link FIXTURE_OUTAGE_REASON}. The retired file is still the domain's real read, so a test can prove an outage
 * never falls back to it.
 *
 * @param readImport the domain's real retired-file read
 * @param decodeStored the domain's real decoder
 * @param errors the domain's real failure factories
 * @returns the seams
 */
export function unavailableSingletonRegisterSeams<Document, Failure>({
  decodeStored,
  errors,
  readImport,
}: {
  decodeStored: SingletonRegisterSeams<Document, Failure>["decodeStored"];
  errors: SingletonRegisterSeams<Document, Failure>["errors"];
  readImport: SingletonRegisterSeams<Document, Failure>["readImport"];
}): SingletonRegisterSeams<Document, Failure> {
  return {
    connect: () => Promise.resolve(err(errors.storeUnavailable({ doing: "be opened", reason: FIXTURE_OUTAGE_REASON }))),
    decodeStored,
    errors,
    readImport,
  };
}
