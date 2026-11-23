/**
 * An in-memory Codex sign-in observation store for unit tests: the REAL store-backed port
 * (`src/codex/signInRecordStore.ts`) over a `Map` standing in for the `codex_sign_in_observation` rows, with the
 * real import-file read. A seam, not a mock (`.claude/rules/testing.md`): a plain object of functions is passed
 * where the production one would be.
 *
 * Because the import read is the real file edge, a test that seeds `codex-signin/<alias>.json` under its throwaway
 * home sees exactly what an install with an empty store sees: the first read imports it once. What this cannot
 * prove is anything Postgres decides — the opt-in `integration/codexSignInObservationStore.test.ts` covers that.
 */
import { CodexSignInErrors } from "../codex/signInErrors.js";
import {
  type CodexSignInImportRead,
  type CodexSignInRows,
  type CodexSignInStoreSeams,
  readCodexSignInImportFile,
  type StoredCodexSignIn,
} from "../codex/signInObservationCurrent.js";
import type { CodexSignInPort } from "../codex/signInPort.js";
import { storeCodexSignInPort } from "../codex/signInRecordStore.js";
import { err, ok } from "../lib/result.js";

/** The in-memory store: one row per home and alias, and a count of the connections opened and closed. */
export interface MemoryCodexSignInStore {
  /** Keyed by {@link memoryCodexSignInKey}, so two homes in one test never share a row. */
  readonly rows: Map<string, StoredCodexSignIn>;
  opened: number;
  closed: number;
}

/**
 * The key one home's alias row sits under in {@link MemoryCodexSignInStore.rows}.
 *
 * @param home the Slopweaver home the row belongs to
 * @param alias the register alias
 * @returns the map key
 */
export function memoryCodexSignInKey({ alias, home }: { alias: string; home: string }): string {
  return `${home}\u0000${alias}`;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row
 */
export function memoryCodexSignInStore(): MemoryCodexSignInStore {
  return { closed: 0, opened: 0, rows: new Map() };
}

/**
 * The row operations over one home's rows in the in-memory store, with the same insert-if-absent and
 * compare-and-set semantics the Postgres statements have.
 *
 * @param home which home's rows this connection addresses
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ home, store }: { home: string; store: MemoryCodexSignInStore }): CodexSignInRows {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ alias, record }) => {
      const key = memoryCodexSignInKey({ alias, home });
      if (store.rows.has(key)) {
        return Promise.resolve(ok(undefined));
      }
      const row = { alias, record: structuredClone(record), revision: 1 };
      store.rows.set(key, row);
      return Promise.resolve(ok(row));
    },
    read: ({ aliases }) =>
      Promise.resolve(
        ok(
          aliases.flatMap((alias) => {
            const row = store.rows.get(memoryCodexSignInKey({ alias, home }));
            return row === undefined ? [] : [structuredClone(row)];
          }),
        ),
      ),
    update: ({ alias, expectedRevision, record }) => {
      const key = memoryCodexSignInKey({ alias, home });
      const current = store.rows.get(key);
      if (current?.revision !== expectedRevision) {
        return Promise.resolve(ok(undefined));
      }
      const row = { alias, record: structuredClone(record), revision: expectedRevision + 1 };
      store.rows.set(key, row);
      return Promise.resolve(ok(row));
    },
  };
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @param readImportFile the import read, the real one unless a test replaces it to count or fail it
 * @returns the seams
 */
export function memoryCodexSignInSeams({
  readImportFile = readCodexSignInImportFile,
  store,
}: {
  readImportFile?: (request: { readonly alias: string; readonly home: string }) => CodexSignInImportRead;
  store: MemoryCodexSignInStore;
}): CodexSignInStoreSeams {
  return {
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ home, store })));
    },
    readImportFile,
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `codexSignInPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect or share it; a fresh one otherwise
 * @returns the port
 */
export function memoryCodexSignInPort({
  store = memoryCodexSignInStore(),
}: { store?: MemoryCodexSignInStore } = {}): CodexSignInPort {
  return storeCodexSignInPort({ seams: memoryCodexSignInSeams({ store }) });
}

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableCodexSignInPort(): CodexSignInPort {
  const outage = CodexSignInErrors.storeUnavailable({
    doing: "be opened",
    reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
  });
  return {
    read: () => Promise.resolve(err(outage)),
    record: () => Promise.resolve(err(outage)),
  };
}
