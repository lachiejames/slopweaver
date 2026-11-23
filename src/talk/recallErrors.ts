/**
 * The `talk recall` domain's typed error union (`.claude/rules/error-handling.md`): what a caller of the recall
 * ladder branches on. A malformed pointer is the CALLER's mistake and exits as usage; a pointer naming nothing, an
 * unreadable source and an unavailable store are facts about this machine and exit as errors.
 */

/** A pointer that is not one of the canonical spellings `./recall.ts` mints. */
export interface RecallPointerMalformedError {
  readonly code: "RECALL_POINTER_MALFORMED";
  readonly message: string;
  readonly pointer: string;
}

/** A well-formed pointer whose record is not there (any more). */
export interface RecallNotFoundError {
  readonly code: "RECALL_NOT_FOUND";
  readonly message: string;
  readonly pointer: string;
}

/** The file or ledger a pointer names could not be read. */
export interface RecallSourceUnreadableError {
  readonly code: "RECALL_SOURCE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The local store did not answer, is not local, or failed the query. */
export interface RecallStoreUnavailableError {
  readonly code: "RECALL_STORE_UNAVAILABLE";
  readonly message: string;
}

/** An answer whose fixed fields alone pass the byte cap it was asked to keep. */
export interface RecallAnswerTooLargeError {
  readonly code: "RECALL_ANSWER_TOO_LARGE";
  readonly message: string;
}

/** Every way the recall ladder fails. */
export type RecallError =
  | RecallPointerMalformedError
  | RecallNotFoundError
  | RecallSourceUnreadableError
  | RecallStoreUnavailableError
  | RecallAnswerTooLargeError;

export const RecallErrors = {
  answerTooLarge: ({ bytes, maxBytes }: { bytes: number; maxBytes: number }): RecallAnswerTooLargeError => ({
    code: "RECALL_ANSWER_TOO_LARGE",
    message: `talk recall: the answer's fixed fields alone are ${String(bytes)} bytes, past --max-bytes ${String(maxBytes)} — raise it`,
  }),
  notFound: ({ pointer, what }: { pointer: string; what: string }): RecallNotFoundError => ({
    code: "RECALL_NOT_FOUND",
    message: `talk recall: ${pointer} names ${what}, which is not there`,
    pointer,
  }),
  pointerMalformed: ({ pointer, why }: { pointer: string; why: string }): RecallPointerMalformedError => ({
    code: "RECALL_POINTER_MALFORMED",
    message: `talk recall: ${pointer} is not a recall pointer (${why}) — pass one exactly as a search hit printed it`,
    pointer,
  }),
  sourceUnreadable: ({ path, cause }: { path: string; cause: unknown }): RecallSourceUnreadableError => ({
    code: "RECALL_SOURCE_UNREADABLE",
    message: `talk recall: could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  storeUnavailable: ({ why }: { why: string }): RecallStoreUnavailableError => ({
    code: "RECALL_STORE_UNAVAILABLE",
    message: `talk recall: the knowledge store could not be read — ${why}`,
  }),
} as const;
