/**
 * The store-backed fallback record: every request and receipt row read from, and written once into, the
 * store. This module is the ORCHESTRATION; every effect arrives through {@link FallbackRegisterStoreSeams}, so a
 * unit test drives every branch over a plain in-memory fake (a seam, not a mock: `.claude/rules/testing.md`).
 * The Postgres half is `./fallbackStoreRows.ts`; what only a real database can prove (the insert-if-absent
 * statements, the foreign key, the CHECKs) is the opt-in `src/__tests__/integration/codexFallbackStore.test.ts`.
 *
 * Every operation opens one connection and always closes it. A seam that rejects rather than answering a
 * Result is still a step that did not finish, so it is the same refusal, `FALLBACK_STORE_UNAVAILABLE` — never a
 * raw rejection standing in for "the fallback evidence is unknown".
 */
import { err, ok, type Result } from "#lib/result.js";

import { fallbackReceiptRow, fallbackRequestRow } from "../store/fleet/codexFallback.js";
import type { NewCodexFallbackReceiptRecord, NewCodexFallbackRequestRecord } from "../store/schema/codexFallback.js";
import { withStoreConnection } from "../store/withConnection.js";
import { scanFallbackDocuments } from "./fallbackDocuments.js";
import type { FallbackRegisterPort, StoredFallbackRequest } from "./fallbackPort.js";
import {
  type FallbackStoreError,
  FallbackStoreErrors,
  type FallbackStoreUnavailableError,
} from "./fallbackStoreErrors.js";

/** One stored request as the store returned it, with its receipt's text when one was recorded. */
export interface StoredFallbackRow {
  readonly requestId: string;
  readonly requestText: string;
  readonly receiptText: string | null;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface FallbackRows {
  /** Every request, in request-id order, each joined to its receipt. */
  readonly readAll: () => Promise<Result<readonly StoredFallbackRow[], FallbackStoreUnavailableError>>;
  /** One request joined to its receipt, or undefined when no row carries that id. */
  readonly readOne: (request: {
    readonly requestId: string;
  }) => Promise<Result<StoredFallbackRow | undefined, FallbackStoreUnavailableError>>;
  /** Insert unless the id exists; false when it did, which this writer then lost. */
  readonly insertRequest: (request: {
    readonly row: NewCodexFallbackRequestRecord;
  }) => Promise<Result<boolean, FallbackStoreUnavailableError>>;
  /** Insert unless a receipt exists for the request; false when one did. */
  readonly insertReceipt: (request: {
    readonly row: NewCodexFallbackReceiptRecord;
  }) => Promise<Result<boolean, FallbackStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed record performs, injected so the orchestration is testable without one. */
export interface FallbackRegisterStoreSeams {
  /** Open the store for one home, refusing with `FALLBACK_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<FallbackRows, FallbackStoreUnavailableError>>;
}

/**
 * The store refusal for a seam that rejected rather than answering a Result.
 *
 * @param cause what the seam rejected with
 * @param doing what the step was for, finishing "the store could not …"
 * @returns the typed refusal
 */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): FallbackStoreUnavailableError {
  const reason = cause instanceof Error ? cause.message : "unknown failure";
  return FallbackStoreErrors.storeUnavailable({ doing, reason });
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams where the connection comes from
 * @param body what to do with it
 * @returns whatever the body answered, or the connection refusal
 */
async function withRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: FallbackRows) => Promise<Result<T, FallbackStoreError>>;
  home: string;
  seams: FallbackRegisterStoreSeams;
}): Promise<Result<T, FallbackStoreError>> {
  // A lost insert stays FALLBACK_REQUEST_ID_TAKEN or FALLBACK_RECEIPT_ALREADY_RECORDED when the close then fails.
  return withStoreConnection<FallbackRows, T, FallbackStoreError>({
    body,
    connect: () => seams.connect({ home }),
    unavailable,
  });
}

/**
 * Why a text cannot be stored verbatim, or undefined when it can. Postgres `text` cannot carry a NUL byte, and
 * stripping one would change the bytes a receipt's digest binds to.
 */
function unstorable({
  document,
  requestId,
  text,
}: {
  document: "request" | "receipt";
  requestId: string;
  text: string;
}): FallbackStoreError | undefined {
  if (!text.includes("\u0000")) {
    return undefined;
  }
  return FallbackStoreErrors.documentUnstorable({ document, reason: "it holds a NUL byte", requestId });
}

/**
 * A fallback register port whose authority is the store rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./fallbackStoreRows.ts`'s `productionFallbackRegisterSeams`
 * @returns the port
 */
export function storeFallbackRegisterPort({ seams }: { seams: FallbackRegisterStoreSeams }): FallbackRegisterPort {
  return {
    readRequest: ({ home, requestId }) => withRows({ body: (rows) => requestRow({ requestId, rows }), home, seams }),
    scan: ({ home }) =>
      withRows({
        body: async (rows) => (await rows.readAll()).map((documents) => scanFallbackDocuments({ documents })),
        home,
        seams,
      }),
    writeReceipt: async ({ home, receiptText, requestId }) => {
      const refused = unstorable({ document: "receipt", requestId, text: receiptText });
      if (refused !== undefined) {
        return err(refused);
      }
      const row = fallbackReceiptRow({ receiptText, requestId });
      const lost = FallbackStoreErrors.receiptAlreadyRecorded({ requestId });
      return withRows({
        body: async (rows) => insertedOnce({ inserted: await rows.insertReceipt({ row }), lost }),
        home,
        seams,
      });
    },
    writeRequest: async ({ home, requestId, requestText }) => {
      const refused = unstorable({ document: "request", requestId, text: requestText });
      if (refused !== undefined) {
        return err(refused);
      }
      const row = fallbackRequestRow({ requestId, requestText });
      const lost = FallbackStoreErrors.requestIdTaken({ requestId });
      return withRows({
        body: async (rows) => insertedOnce({ inserted: await rows.insertRequest({ row }), lost }),
        home,
        seams,
      });
    },
  };
}

/** One stored request by id, over an open connection; no row carrying it is `FALLBACK_REQUEST_NOT_FOUND`. */
async function requestRow({
  requestId,
  rows,
}: {
  requestId: string;
  rows: FallbackRows;
}): Promise<Result<StoredFallbackRequest, FallbackStoreError>> {
  const found = await rows.readOne({ requestId });
  if (found.isErr()) {
    return err(found.error);
  }
  if (found.value === undefined) {
    return err(FallbackStoreErrors.requestNotFound({ requestId }));
  }
  return ok({ receiptRecorded: found.value.receiptText !== null, requestId, requestText: found.value.requestText });
}

/** One insert-if-absent attempt, never retried: an insert that found its row already there is `lost`. */
function insertedOnce({
  inserted,
  lost,
}: {
  inserted: Result<boolean, FallbackStoreError>;
  lost: FallbackStoreError;
}): Result<undefined, FallbackStoreError> {
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  return inserted.value ? ok(undefined) : err(lost);
}
