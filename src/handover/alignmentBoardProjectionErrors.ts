/**
 * The typed failures of reading or writing the Alignment board projection (`./alignmentBoardProjection.ts`).
 *
 * Its own union, per `.claude/rules/error-handling.md`: a caller branches on these to decide whether the cache
 * is simply not there yet (a first run), is there and broken (rebuild it, and say so), or could not be written
 * (warn, and print the board anyway). None of them is ever read as an empty board.
 *
 * Pure: every factory takes already-read values.
 */

/** No projection file at the path — a first run, or a home `handover list` has never written one to. */
export interface AlignmentBoardMissingError {
  readonly code: "ALIGNMENT_BOARD_MISSING";
  readonly message: string;
  readonly path: string;
}

/** The file is there and the filesystem would not hand it over. */
export interface AlignmentBoardUnreadableError {
  readonly code: "ALIGNMENT_BOARD_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The file read and is not a projection this build writes — not JSON, another schema version, or one bad row. */
export interface AlignmentBoardInvalidError {
  readonly code: "ALIGNMENT_BOARD_INVALID";
  readonly message: string;
  readonly path: string;
}

/** The projection could not be written. */
export interface AlignmentBoardWriteFailedError {
  readonly code: "ALIGNMENT_BOARD_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every way reading or writing the Alignment board projection can fail. */
export type AlignmentBoardProjectionError =
  | AlignmentBoardMissingError
  | AlignmentBoardUnreadableError
  | AlignmentBoardInvalidError
  | AlignmentBoardWriteFailedError;

/** The one place an `AlignmentBoardProjectionError` is constructed, so a test builds what the real code builds. */
export const AlignmentBoardProjectionErrors = {
  invalid: ({ path, detail }: { path: string; detail: string }): AlignmentBoardInvalidError => ({
    code: "ALIGNMENT_BOARD_INVALID",
    message: `the Alignment board projection at ${path} will not read (${detail})`,
    path,
  }),
  missing: ({ path }: { path: string }): AlignmentBoardMissingError => ({
    code: "ALIGNMENT_BOARD_MISSING",
    message: `no Alignment board projection at ${path} yet`,
    path,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): AlignmentBoardUnreadableError => ({
    code: "ALIGNMENT_BOARD_UNREADABLE",
    message: `could not read the Alignment board projection at ${path}: ${detail}`,
    path,
  }),
  writeFailed: ({ path, detail }: { path: string; detail: string }): AlignmentBoardWriteFailedError => ({
    code: "ALIGNMENT_BOARD_WRITE_FAILED",
    message: `could not write the Alignment board projection at ${path}: ${detail}`,
    path,
  }),
} as const;
