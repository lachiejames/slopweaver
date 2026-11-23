/**
 * What the candidates tests stand on beside `./registerWorkstreamsFixture.ts`'s register: a counting `mintId`
 * (canonical UUIDs `00000000-0000-4000-8000-0000000000NN`, from 1), the register document, a store seeded with the
 * register through its own `applyBatch`, and a store whose writes or reads fail — a plain wrapper, never a mock.
 */
import { err, unwrap } from "#lib/result.js";
import { WorkstreamStoreErrors } from "../../../workstreams/store/errors.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import type {
  WorkstreamAggregate,
  WorkstreamRegisterMeta,
  WorkstreamRegisterSnapshot,
} from "../../../workstreams/store/types.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";

import { registerWorkstreams } from "./registerWorkstreamsFixture.js";

/** The instant the seeded store stamps. */
const SEEDED_AT = "2026-10-01T09:00:00.000Z";

/**
 * A `mintId` seam counting from 1, so a test can name every id a write mints.
 *
 * @returns the seam
 */
export function countingMintId(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return mintedId({ n: next });
  };
}

/**
 * The id {@link countingMintId} mints on its `n`th call.
 *
 * @returns the canonical UUID
 */
export function mintedId({ n }: { n: number }): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** The register document: one Slack conversation named, two initiatives. */
export const REGISTER_META: WorkstreamRegisterMeta = {
  channels: { C0SYNPLATFORM: "#platform-squad" },
  grouping: {
    anchor: "transcript:a#b",
    builtFrom: "the owner's 1 Oct call",
    label: "B",
    why: "initiatives over workstreams",
  },
  initiatives: [
    { id: "security", name: "Security" },
    { id: "reliability", name: "Reliability" },
  ],
};

/**
 * An in-memory store holding the register, written through its own `applyBatch` so a fixture the store would refuse
 * fails here rather than in the test.
 *
 * @param workstreams what it holds; the whole fixture register when absent
 * @param meta the register document; {@link REGISTER_META} when absent, `null` for a store holding none
 * @param nowIso the instant every later write stamps
 * @returns the store
 */
export async function seededStore({
  workstreams = registerWorkstreams(),
  meta = REGISTER_META,
  nowIso = SEEDED_AT,
}: {
  workstreams?: readonly WorkstreamAggregate[];
  meta?: WorkstreamRegisterMeta | null;
  nowIso?: string;
} = {}): Promise<WorkstreamStore> {
  const store = inMemoryWorkstreamStore({ nowIso });
  const writes = workstreams.map((aggregate) => ({ aggregate, expectedRevision: null }));
  if (meta === null) {
    if (writes.length > 0) {
      unwrap(await store.applyBatch({ deletes: [], home: "", writes }));
    }
    return store;
  }
  unwrap(await store.applyBatch({ deletes: [], home: "", meta: { document: meta, expectedRevision: null }, writes }));
  return store;
}

/**
 * The register as a read of a store seeded with it returns it — what a reader of the store is handed.
 *
 * @param workstreams what it holds; the whole fixture register when absent
 * @param meta the register document; {@link REGISTER_META} when absent, `null` for a store holding none
 * @returns the snapshot
 */
export async function registerSnapshot({
  workstreams = registerWorkstreams(),
  meta = REGISTER_META,
}: {
  workstreams?: readonly WorkstreamAggregate[];
  meta?: WorkstreamRegisterMeta | null;
} = {}): Promise<WorkstreamRegisterSnapshot> {
  const store = await seededStore({ meta, workstreams });
  return unwrap(await store.read({ home: "" }));
}

/**
 * A store that reads and writes through `store` except where it is told to fail, refusing with the conflict a lost
 * race or an unreachable database would — so a test can drive the path a failed register write takes.
 *
 * @param fail which call refuses
 * @returns the wrapped store
 */
export function failingStore({ store, fail }: { store: WorkstreamStore; fail: "read" | "write" }): WorkstreamStore {
  const refusal = WorkstreamStoreErrors.unavailable({ doing: fail, reason: "the fixture refuses it" });
  if (fail === "read") {
    return { ...store, read: async () => err(refusal) };
  }
  return { ...store, applyBatch: async () => err(refusal), put: async () => err(refusal) };
}
