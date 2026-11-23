/**
 * An in-memory plan register store for unit tests: the REAL store-backed port (`src/plans/storePort.ts`) over
 * a `Map` standing in for the `plan_register` row, with the real legacy-file read, the real projection writer
 * and the real divergence diagnostics. A seam, not a mock (`.claude/rules/testing.md`): nothing is stubbed out
 * of a module, a plain object of functions is passed where the production one would be.
 *
 * Because the legacy read and the projections are the real file edge, a test that seeds `plans.json` or a
 * Claude accounts file under its throwaway home sees exactly what an install with an empty store sees: the
 * first read imports a `plans.json` once (or derives the unadopted picture), and every write regenerates both
 * files. What this cannot prove is anything Postgres decides — the opt-in
 * `integration/planRegisterStore.test.ts` covers that.
 */
import { err, ok } from "../lib/result.js";
import { PlanRegisterErrors, type RegisterStoreUnavailableError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import {
  clearSeatPassesBeforeCommit,
  readPlanRegisterFile,
  storedRegisterDiagnostics,
  writePlanRegisterProjections,
} from "../plans/store.js";
import {
  type PlanRegisterRows,
  type PlanRegisterStoreSeams,
  type StoredPlanRegister,
  storePlanRegisterPort,
} from "../plans/storePort.js";
import { memoryRevisionRows } from "./singletonRegisterFixture.js";

/** The in-memory store: one row per home, and a count of the connections opened and closed. */
export interface MemoryPlanRegisterStore {
  readonly rows: Map<string, StoredPlanRegister>;
  opened: number;
  closed: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for any home
 */
export function memoryPlanRegisterStore(): MemoryPlanRegisterStore {
  return { closed: 0, opened: 0, rows: new Map() };
}

/**
 * The row operations over one home's slot: the singleton registers' in-memory rows, whose row and semantics are
 * the plan register's exactly.
 *
 * @param home which row this connection addresses
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ home, store }: { home: string; store: MemoryPlanRegisterStore }): PlanRegisterRows {
  return memoryRevisionRows<RegisterStoreUnavailableError>({ home, store });
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store the connection addresses
 * @returns the seams
 */
export function memoryPlanRegisterSeams({ store }: { store: MemoryPlanRegisterStore }): PlanRegisterStoreSeams {
  return {
    clearSeatPasses: clearSeatPassesBeforeCommit,
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ home, store })));
    },
    diagnose: storedRegisterDiagnostics,
    readImportFile: readPlanRegisterFile,
    writeProjections: writePlanRegisterProjections,
  };
}

/**
 * The store-backed port over a fresh in-memory store — the drop-in for `planRegisterPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect it; a fresh one otherwise
 * @returns the port
 */
export function memoryPlanRegisterPort({
  store = memoryPlanRegisterStore(),
}: { store?: MemoryPlanRegisterStore } = {}): PlanRegisterPort {
  return storePlanRegisterPort({ seams: memoryPlanRegisterSeams({ store }) });
}

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailablePlanRegisterPort(): PlanRegisterPort {
  const outage = PlanRegisterErrors.registerStoreUnavailable({
    doing: "be opened",
    reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
  });
  return {
    read: () => Promise.resolve(err(outage)),
    write: () => Promise.resolve(err(outage)),
  };
}
