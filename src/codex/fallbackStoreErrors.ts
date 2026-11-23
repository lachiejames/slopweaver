/**
 * Every way the Claude fallback register's store can refuse — the typed union `./fallbackPort.ts` answers in.
 *
 * Parsing what a stored request MEANS stays a `CodexError` (`./errors.ts`): this domain answers which bytes
 * exist and whether a write landed, never whether a document is a valid review. A message here never carries
 * the connection string — `connectStore`'s own refusals are written to be printed, and a driver error is
 * reduced to its own message.
 */

/** The store could not be opened, queried or closed — selection, connection, a foreign schema or a statement. */
export interface FallbackStoreUnavailableError {
  readonly code: "FALLBACK_STORE_UNAVAILABLE";
  readonly message: string;
}

/** No request row carries that id. */
export interface FallbackRequestNotFoundError {
  readonly code: "FALLBACK_REQUEST_NOT_FOUND";
  readonly message: string;
  readonly requestId: string;
}

/** A request insert returned no row: that id is already a request. */
export interface FallbackRequestIdTakenError {
  readonly code: "FALLBACK_REQUEST_ID_TAKEN";
  readonly message: string;
  readonly requestId: string;
}

/** A receipt insert returned no row: that request is already answered. */
export interface FallbackReceiptAlreadyRecordedError {
  readonly code: "FALLBACK_RECEIPT_ALREADY_RECORDED";
  readonly message: string;
  readonly requestId: string;
}

/** A document Postgres `text` cannot hold verbatim. */
export interface FallbackDocumentUnstorableError {
  readonly code: "FALLBACK_DOCUMENT_UNSTORABLE";
  readonly message: string;
  readonly requestId: string;
  readonly document: "request" | "receipt";
}

/** Every failure the fallback register's store answers. */
export type FallbackStoreError =
  | FallbackStoreUnavailableError
  | FallbackRequestNotFoundError
  | FallbackRequestIdTakenError
  | FallbackReceiptAlreadyRecordedError
  | FallbackDocumentUnstorableError;

/** The factories every fallback store failure is built through. */
export const FallbackStoreErrors = {
  documentUnstorable: ({
    document,
    reason,
    requestId,
  }: {
    document: "request" | "receipt";
    reason: string;
    requestId: string;
  }): FallbackDocumentUnstorableError => ({
    code: "FALLBACK_DOCUMENT_UNSTORABLE",
    document,
    message: `fallback ${document} ${requestId} cannot be stored verbatim: ${reason}`,
    requestId,
  }),
  receiptAlreadyRecorded: ({ requestId }: { requestId: string }): FallbackReceiptAlreadyRecordedError => ({
    code: "FALLBACK_RECEIPT_ALREADY_RECORDED",
    message: `request ${requestId} already has a receipt in the store — one request is one answer; prepare a new one`,
    requestId,
  }),
  requestIdTaken: ({ requestId }: { requestId: string }): FallbackRequestIdTakenError => ({
    code: "FALLBACK_REQUEST_ID_TAKEN",
    message: `fallback request id ${requestId} is already in the store, so nothing was written`,
    requestId,
  }),
  requestNotFound: ({ requestId }: { requestId: string }): FallbackRequestNotFoundError => ({
    code: "FALLBACK_REQUEST_NOT_FOUND",
    message: `no fallback request ${requestId} is in the store — prepare one first`,
    requestId,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): FallbackStoreUnavailableError => ({
    code: "FALLBACK_STORE_UNAVAILABLE",
    message:
      `the Claude fallback plans and reviews live in the store, and the store could not ${doing}, so rule 9's ` +
      `fallback evidence is UNKNOWN — refusing rather than reading a home directory that stopped being the ` +
      `record (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
