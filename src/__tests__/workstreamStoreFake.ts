/**
 * An in-memory `WorkstreamStore` for tests that drive a verb without a database — a plain stateful object, never a
 * mock. It refuses exactly what the store refuses because each write is the pure function in
 * `./workstreamStoreFakeWrites.ts`, which asks the same judges the port does and answers through the port's own refusal
 * mapping; only what a real database alone can prove (locks, races, constraints) is left to
 * `integration/workstreamStore.test.ts`.
 *
 * One instance is one selected store, so `home` is accepted and ignored. Its clock is the `nowIso` it was built with,
 * in UTC as the store reads a `timestamptz` back: every write stamps it, and a create stamps it as `createdAtIso` too.
 */
import { err, ok, type Result } from "../lib/result.js";
import { byCodeUnit } from "../workstreams/store/canonical.js";
import type { WorkstreamStoreError } from "../workstreams/store/errors.js";
import type { WorkstreamStore } from "../workstreams/store/port.js";
import type { WorkstreamRegisterSnapshot } from "../workstreams/store/types.js";

import { batchAfter, type FakeState, putAfter, putMetaAfter, removeAfter } from "./workstreamStoreFakeWrites.js";

/**
 * The fake store.
 *
 * @param initial what it holds at the start; an empty store when absent
 * @param nowIso the instant every write stamps
 * @returns a `WorkstreamStore` over its own state
 */
export function inMemoryWorkstreamStore({
  initial,
  nowIso: clock,
}: {
  initial?: WorkstreamRegisterSnapshot;
  nowIso: string;
}): WorkstreamStore {
  // The clock as a `timestamptz` hands it back: UTC, milliseconds, `Z` — so an offset instant reads as the store's.
  const instant = new Date(clock);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`inMemoryWorkstreamStore: nowIso ${clock} is not an instant`);
  }
  const nowIso = instant.toISOString();
  // Everything crosses the boundary as a copy, as a database row does: a caller mutating what it passed in or got back
  // never reaches what the fake holds.
  const seed = structuredClone(initial);
  let state: FakeState = {
    meta: seed === undefined ? null : seed.meta,
    workstreams: new Map((seed === undefined ? [] : seed.workstreams).map((one) => [one.id, one])),
  };

  return {
    applyBatch: async ({ home: _home, ...request }) =>
      batchAfter({ nowIso, request, state }).map((after) => {
        state = after.state;
        return structuredClone(after.result);
      }),
    put: async ({ aggregate, expectedRevision }) =>
      putAfter({ aggregate, expectedRevision, nowIso, state }).map((after) => {
        state = after.state;
        return structuredClone(after.result);
      }),
    putMeta: async ({ document, expectedRevision }) =>
      putMetaAfter({ document, expectedRevision, nowIso, state }).map((after) => {
        state = after;
        return structuredClone(after.meta);
      }),
    read: async (): Promise<Result<WorkstreamRegisterSnapshot, WorkstreamStoreError>> =>
      ok(
        structuredClone({
          meta: state.meta,
          workstreams: [...state.workstreams.values()].toSorted((a, b) => byCodeUnit({ a: a.id, b: b.id })),
        }),
      ),
    remove: async ({ expectedRevision, workstreamId }) => {
      const after = removeAfter({ expectedRevision, state, workstreamId });
      if (after.isErr()) {
        return err(after.error);
      }
      state = after.value;
      return ok(undefined);
    },
  };
}
