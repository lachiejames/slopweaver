/**
 * The one door every reader and writer of the Claude fallback record goes through — rule 9's evidence when
 * Codex is capped.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the
 * home becomes deletable. The `codex_fallback_request` and `codex_fallback_receipt` rows
 * (`../store/schema/codexFallback.ts`) are the record; `$SLOPWEAVER_HOME/codex-fallback/` is only the source
 * of the one-time import, `slopweaver store import-fleet --only codex-fallback`, and nothing here reads it. A
 * store that cannot be opened — none selected, unreachable, or a schema this checkout does not carry — is
 * `FALLBACK_STORE_UNAVAILABLE`, never a directory read: a lost BROKEN review is exactly what a disk fallback
 * could hide.
 *
 * The packets a session reads (`review-packet.md`, `plan-packet.md`) are scratch, not record, and are written
 * outside the home (`./fallbackPacket.ts`).
 *
 * ## Injection
 *
 * Only a composition root calls {@link fallbackRegisterPort}. A unit test, which may not mock, passes a plain
 * {@link FallbackRegisterPort} value — `src/__tests__/fallbackRegisterFixture.ts` builds one over in-memory
 * rows. That is a seam, not a mock: `.claude/rules/testing.md` § "A unit test tests a PURE function".
 */
import type { Result } from "#lib/result.js";

import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import type { FallbackStoreError } from "./fallbackStoreErrors.js";
import { storeFallbackRegisterPort } from "./fallbackStorePort.js";
import { productionFallbackRegisterSeams } from "./fallbackStoreRows.js";

/** One stored request: its exact text and whether a receipt row answers it. */
export interface StoredFallbackRequest {
  readonly requestId: string;
  readonly requestText: string;
  readonly receiptRecorded: boolean;
}

/**
 * The fallback record's four operations, as one value a caller threads.
 *
 * Every write is ONE insert-if-absent attempt and is never retried: a lost request insert is
 * `FALLBACK_REQUEST_ID_TAKEN`, a lost receipt insert `FALLBACK_RECEIPT_ALREADY_RECORDED`, so two recorders that
 * both read "unanswered" end with exactly one receipt.
 */
export interface FallbackRegisterPort {
  /** Every stored request, classified into the scan the landing floor and `codex status` read. */
  readonly scan: (request: { readonly home: string }) => Promise<Result<FallbackReceiptScan, FallbackStoreError>>;
  /** One stored request by id. */
  readonly readRequest: (request: {
    readonly home: string;
    readonly requestId: string;
  }) => Promise<Result<StoredFallbackRequest, FallbackStoreError>>;
  /** Write a new request row, exactly once. */
  readonly writeRequest: (request: {
    readonly home: string;
    readonly requestId: string;
    readonly requestText: string;
  }) => Promise<Result<undefined, FallbackStoreError>>;
  /** Write the receipt row answering a request, exactly once. */
  readonly writeReceipt: (request: {
    readonly home: string;
    readonly requestId: string;
    readonly receiptText: string;
  }) => Promise<Result<undefined, FallbackStoreError>>;
}

/**
 * The port this install's fallback record is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function fallbackRegisterPort(): FallbackRegisterPort {
  return storeFallbackRegisterPort({ seams: productionFallbackRegisterSeams() });
}
