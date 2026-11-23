/**
 * An in-memory Claude fallback record for unit tests: the REAL store-backed port (`src/codex/fallbackStorePort.ts`)
 * over a `Map` standing in for the `codex_fallback_request` and `codex_fallback_receipt` rows, with the same
 * insert-if-absent semantics the Postgres statements have. A seam, not a mock (`.claude/rules/testing.md`):
 * nothing is stubbed out of a module, a plain object of functions is passed where the production one would be.
 *
 * What this cannot prove is anything Postgres decides — the foreign key, the CHECKs, the join — and the opt-in
 * `integration/codexFallbackStore.test.ts` covers that.
 */
import type { ClaudeFallbackPlanReceipt, ClaudeFallbackPlanRequest } from "../codex/fallbackPlan.js";
import type { FallbackRegisterPort } from "../codex/fallbackPort.js";
import { fallbackReceiptText, fallbackRequestText } from "../codex/fallbackRequestRead.js";
import type { ClaudeFallbackReviewReceipt, ClaudeFallbackReviewRequest } from "../codex/fallbackReview.js";
import { FallbackStoreErrors } from "../codex/fallbackStoreErrors.js";
import {
  type FallbackRegisterStoreSeams,
  type FallbackRows,
  type StoredFallbackRow,
  storeFallbackRegisterPort,
} from "../codex/fallbackStorePort.js";
import { err, ok, unwrap } from "../lib/result.js";

/** The in-memory store: one row per request id, and a count of the connections opened and closed. */
export interface MemoryFallbackStore {
  readonly rows: Map<string, StoredFallbackRow>;
  opened: number;
  closed: number;
}

/**
 * A fresh, empty in-memory store.
 *
 * @returns the store, holding no request
 */
export function memoryFallbackStore(): MemoryFallbackStore {
  return { closed: 0, opened: 0, rows: new Map() };
}

/** The row operations over the in-memory store, with the Postgres statements' insert-if-absent semantics. */
function memoryRows({ store }: { store: MemoryFallbackStore }): FallbackRows {
  return {
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insertReceipt: ({ row }) => {
      const request = store.rows.get(row.requestId);
      if (request === undefined) {
        // The foreign key: a receipt for no request is a statement Postgres refuses.
        return Promise.resolve(
          err(FallbackStoreErrors.storeUnavailable({ doing: "write a receipt", reason: "foreign key violation" })),
        );
      }
      if (request.receiptText !== null) {
        return Promise.resolve(ok(false));
      }
      store.rows.set(row.requestId, { ...request, receiptText: row.receiptText });
      return Promise.resolve(ok(true));
    },
    insertRequest: ({ row }) => {
      if (store.rows.has(row.requestId)) {
        return Promise.resolve(ok(false));
      }
      store.rows.set(row.requestId, { receiptText: null, requestId: row.requestId, requestText: row.requestText });
      return Promise.resolve(ok(true));
    },
    readAll: () =>
      Promise.resolve(ok([...store.rows.values()].toSorted((a, b) => a.requestId.localeCompare(b.requestId)))),
    readOne: ({ requestId }) => Promise.resolve(ok(store.rows.get(requestId))),
  };
}

/**
 * The production seams with the database swapped for an in-memory store.
 *
 * @param store the in-memory store every connection addresses
 * @returns the seams
 */
function memoryFallbackSeams({ store }: { store: MemoryFallbackStore }): FallbackRegisterStoreSeams {
  return {
    connect: () => {
      store.opened += 1;
      return Promise.resolve(ok(memoryRows({ store })));
    },
  };
}

/**
 * The store-backed port over an in-memory store — the drop-in for `fallbackRegisterPort()` in a unit test.
 *
 * @param store the in-memory store to use, when a test wants to inspect or seed it; a fresh one otherwise
 * @returns the port
 */
export function memoryFallbackRegisterPort({
  store = memoryFallbackStore(),
}: { store?: MemoryFallbackStore } = {}): FallbackRegisterPort {
  return storeFallbackRegisterPort({ seams: memoryFallbackSeams({ store }) });
}

/**
 * Write a request through a port exactly as `prepare` does — the same text shape — and answer its bytes, which
 * a receipt then binds to. Throws on a refusal: a fixture that could not seed its world is a broken test.
 *
 * @param port the port to write through
 * @param home the home the port is asked about
 * @param request the frozen request, review or plan
 * @returns the stored request text
 */
export async function putFallbackRequest({
  port,
  home,
  request,
}: {
  port: FallbackRegisterPort;
  home: string;
  request: ClaudeFallbackReviewRequest | ClaudeFallbackPlanRequest;
}): Promise<string> {
  const requestText = fallbackRequestText({ request });
  unwrap(await port.writeRequest({ home, requestId: request.requestId, requestText }));
  return requestText;
}

/**
 * Write a receipt through a port exactly as `record` does. Throws on a refusal, for the same reason.
 *
 * @param port the port to write through
 * @param home the home the port is asked about
 * @param receipt the validated receipt, review or plan
 */
export async function putFallbackReceipt({
  port,
  home,
  receipt,
}: {
  port: FallbackRegisterPort;
  home: string;
  receipt: ClaudeFallbackReviewReceipt | ClaudeFallbackPlanReceipt;
}): Promise<void> {
  unwrap(
    await port.writeReceipt({ home, receiptText: fallbackReceiptText({ receipt }), requestId: receipt.requestId }),
  );
}

/** The outage every operation of {@link unavailableFallbackRegisterPort} refuses with. */
export const FALLBACK_FIXTURE_OUTAGE = FallbackStoreErrors.storeUnavailable({
  doing: "be opened",
  reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
});

/**
 * A port whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableFallbackRegisterPort(): FallbackRegisterPort {
  return storeFallbackRegisterPort({ seams: { connect: () => Promise.resolve(err(FALLBACK_FIXTURE_OUTAGE)) } });
}
