/**
 * The typed refusals of reading one hygiene document back (`./reportRead.ts`).
 *
 * Its own domain: the writer's failures are one displayed line each and stay on the default `Result`, while a
 * reader's are three things a caller treats differently — a document that was never published, one that is
 * there and would not read, and one whose bytes do not hold the view the caller asked for. None of them is
 * ever an empty document; a caller that reports on them names the gap.
 */

/** No document stands at the path: its producer has never succeeded on this install. */
export interface HygieneDocumentMissingError {
  readonly code: "HYGIENE_DOCUMENT_MISSING";
  readonly message: string;
  readonly path: string;
}

/** A document stands at the path and the filesystem would not read it. */
export interface HygieneDocumentUnreadableError {
  readonly code: "HYGIENE_DOCUMENT_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: string;
}

/** The document read, and its bytes are not JSON or not the view the caller validates. */
export interface HygieneDocumentInvalidError {
  readonly code: "HYGIENE_DOCUMENT_INVALID";
  readonly message: string;
  readonly path: string;
  /** Every problem the parse or the view reported, never only the first. */
  readonly issues: readonly string[];
}

/** Every way reading a hygiene document back can fail. */
export type HygieneDocumentReadError =
  HygieneDocumentMissingError | HygieneDocumentUnreadableError | HygieneDocumentInvalidError;

/** Build each {@link HygieneDocumentReadError} arm with its display message. */
export const HygieneDocumentReadErrors = {
  invalid: ({ path, issues }: { path: string; issues: readonly string[] }): HygieneDocumentInvalidError => ({
    code: "HYGIENE_DOCUMENT_INVALID",
    issues,
    message: `${path} does not hold a document this build reads: ${issues.join("; ")}`,
    path,
  }),
  missing: ({ path }: { path: string }): HygieneDocumentMissingError => ({
    code: "HYGIENE_DOCUMENT_MISSING",
    message: `${path} is not there, so its producer has never succeeded on this install`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: string }): HygieneDocumentUnreadableError => ({
    cause,
    code: "HYGIENE_DOCUMENT_UNREADABLE",
    message: `${path} could not be read: ${cause}`,
    path,
  }),
} as const;
