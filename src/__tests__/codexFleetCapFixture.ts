/**
 * An in-memory Codex fleet-cap store for unit tests: the REAL store-backed port (`src/codex/fleetCapPort.ts`) over a
 * `Map` standing in for the singleton `codex_fleet_cap` row, one slot per home. A seam, not a mock
 * (`.claude/rules/testing.md`): a plain object of functions is passed where the production connection would be.
 *
 * The upsert keeps the record judged at the later `readAtIso`, as the Postgres statement's `setWhere` does, and the
 * marker the later `attemptedAtIso` on a row that exists, as its guarded UPDATE does. What
 * this cannot prove is anything Postgres decides — the opt-in `integration/codexFleetCapStore.test.ts` covers that.
 */
import { CodexFleetCapErrors } from "../codex/fleetCapErrors.js";
import { type CodexFleetCapPort, type CodexFleetCapRows, storeCodexFleetCapPort } from "../codex/fleetCapPort.js";
import type { CodexFleetCapRecord } from "../codex/fleetCapRecord.js";
import type { CodexFleetCapUnfiled } from "../codex/fleetCapUnfiled.js";
import { err, ok } from "../lib/result.js";

/**
 * The in-memory store: one undecoded document per home, the attempt marker per home, a count of the connections
 * opened and closed, and a switch that makes the record's own statement refuse — the seam a failed filing needs.
 */
export interface MemoryCodexFleetCapStore {
  readonly rows: Map<string, unknown>;
  readonly unfiled: Map<string, unknown>;
  opened: number;
  closed: number;
  refuseRecordWrites: boolean;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no row for any home
 */
export function memoryCodexFleetCapStore(): MemoryCodexFleetCapStore {
  return { closed: 0, opened: 0, refuseRecordWrites: false, rows: new Map(), unfiled: new Map() };
}

/** The `attemptedAtIso` a stored marker carries, when it carries one — the ordering the marker's guard reads. */
function storedAttemptedAt({ marker }: { marker: unknown }): string | undefined {
  if (typeof marker !== "object" || marker === null || !("attemptedAtIso" in marker)) {
    return undefined;
  }
  const { attemptedAtIso } = marker;
  return typeof attemptedAtIso === "string" ? attemptedAtIso : undefined;
}

/** The `readAtIso` a stored document carries, when it carries one — the ordering the upsert's guard reads. */
function storedReadAt({ document }: { document: unknown }): string | undefined {
  if (typeof document !== "object" || document === null || !("readAtIso" in document)) {
    return undefined;
  }
  const { readAtIso } = document;
  return typeof readAtIso === "string" ? readAtIso : undefined;
}

/**
 * The row operations over one home's slot, with the same keep-the-later semantics the Postgres upsert has.
 *
 * @param home which slot this connection addresses
 * @param store the in-memory store
 * @returns the operations
 */
function memoryRows({ home, store }: { home: string; store: MemoryCodexFleetCapStore }): CodexFleetCapRows {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    fileIfNotOlder: ({ record }: { record: CodexFleetCapRecord }) => {
      if (store.refuseRecordWrites) {
        return Promise.resolve(
          err(CodexFleetCapErrors.storeUnavailable({ doing: "file", reason: "a fixture refusal of the record write" })),
        );
      }
      const current = store.rows.has(home) ? storedReadAt({ document: store.rows.get(home) }) : undefined;
      if (current !== undefined && Date.parse(current) > Date.parse(record.readAtIso)) {
        return Promise.resolve(ok(false));
      }
      store.rows.set(home, structuredClone(record));
      return Promise.resolve(ok(true));
    },
    markUnfiledIfNotOlder: ({ unfiled }: { unfiled: CodexFleetCapUnfiled }) => {
      // An UPDATE in Postgres: no row, nothing marked.
      if (!store.rows.has(home)) {
        return Promise.resolve(ok(false));
      }
      const current = store.unfiled.has(home) ? storedAttemptedAt({ marker: store.unfiled.get(home) }) : undefined;
      if (current !== undefined && Date.parse(current) > Date.parse(unfiled.attemptedAtIso)) {
        return Promise.resolve(ok(false));
      }
      store.unfiled.set(home, structuredClone(unfiled));
      return Promise.resolve(ok(true));
    },
    read: () => {
      if (!store.rows.has(home)) {
        return Promise.resolve(ok(undefined));
      }
      const unfiled: unknown = store.unfiled.has(home) ? structuredClone(store.unfiled.get(home)) : null;
      return Promise.resolve(ok({ document: structuredClone(store.rows.get(home)), unfiled }));
    },
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `codexFleetCapPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect or seed it; a fresh one otherwise
 * @returns the port
 */
export function memoryCodexFleetCapPort({
  store = memoryCodexFleetCapStore(),
}: { store?: MemoryCodexFleetCapStore } = {}): CodexFleetCapPort {
  return storeCodexFleetCapPort({
    connect: ({ home }) => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ home, store })));
    },
  });
}

/**
 * A port whose store cannot be reached — every read and filing refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableCodexFleetCapPort(): CodexFleetCapPort {
  const outage = CodexFleetCapErrors.storeUnavailable({
    doing: "open",
    reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
  });
  return {
    file: () => Promise.resolve(err(outage)),
    read: () => Promise.resolve(err(outage)),
  };
}
