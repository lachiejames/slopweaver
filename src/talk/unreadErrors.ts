/**
 * Every way `slopweaver talk unread` fails to read the owner's words or keep a reader's place — its own union, because
 * each of these is a reason the read cannot be trusted, and a caller (the tick gate) refuses on all of them alike.
 */

/** A cursor name that cannot be a filename under `talk/unread-cursors`. */
export interface CursorNameInvalidError {
  readonly code: "CURSOR_NAME_INVALID";
  readonly message: string;
  readonly name: string;
}

/**
 * A stored cursor that will not parse. Never read as "no cursor": that would move the reader back to the first-read
 * window and hide every word between it and where the cursor really stood.
 */
export interface CursorMalformedError {
  readonly code: "CURSOR_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** A call file no longer holds, at the cursor's frontier, the line the cursor anchored to — rewritten or cut. */
export interface CallPrefixChangedError {
  readonly code: "CALL_PREFIX_CHANGED";
  readonly message: string;
  readonly callId: string;
}

/** A call file the cursor has read, or the call index records, is no longer there. */
export interface CallFileGoneError {
  readonly code: "CALL_FILE_GONE";
  readonly message: string;
  readonly callId: string;
}

/** The call index holds a line that is not a call id — damage, since the store writes nothing else there. */
export interface CallIndexMalformedError {
  readonly code: "CALL_INDEX_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/**
 * A call file or the call index ends in bytes with no newline after them: a write still landing, or one that died.
 */
export interface TailUnterminatedError {
  readonly code: "TAIL_UNTERMINATED";
  readonly message: string;
  readonly path: string;
}

/** A cursor records more parts of a line printed than the line has — a cursor no mark wrote. */
export interface PartBeyondLineError {
  readonly code: "PART_BEYOND_LINE";
  readonly message: string;
  readonly callId: string;
}

/**
 * The call quarantine ledger could not be read or is damaged — refused rather than read as accepting no loss, which
 * would turn every accepted call back into a refusal, or worse, accept one nobody quarantined.
 */
export interface QuarantineUnreadableError {
  readonly code: "QUARANTINE_UNREADABLE";
  readonly message: string;
}

/** A call file, the calls directory or the cursor could not be read or written. */
export interface UnreadPathFailedError {
  readonly code: "UNREAD_PATH_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * The cursor moved between the read a write was computed from and the write — another mark — or its lock was held. Nothing is recorded, so a rerun reads and prints again.
 */
export interface CursorMovedError {
  readonly code: "CURSOR_MOVED";
  readonly message: string;
  readonly path: string;
}

/**
 * An adopt apply whose digest is not the one this read computes — the backlog, the cursor or the instant changed
 * since the preview, so what the preview showed is not what would be written.
 */
export interface AdoptDigestStaleError {
  readonly code: "ADOPT_DIGEST_STALE";
  readonly message: string;
}

/**
 * The record a cursor write stages behind was stored, and the staged cursor then failed to install — its fsync or its
 * rename. The cursor did NOT move, so nothing passed unrecorded; the record names a move that did not happen.
 */
export interface CursorInstallFailedError {
  readonly code: "CURSOR_INSTALL_FAILED";
  readonly message: string;
  readonly path: string;
  readonly recordPath: string;
  readonly cause: unknown;
}

/** Every way `talk unread` fails. */
export type UnreadError =
  | AdoptDigestStaleError
  | CursorInstallFailedError
  | CursorMovedError
  | CursorNameInvalidError
  | CursorMalformedError
  | CallPrefixChangedError
  | CallFileGoneError
  | CallIndexMalformedError
  | TailUnterminatedError
  | PartBeyondLineError
  | QuarantineUnreadableError
  | UnreadPathFailedError;

/** The factories every `talk unread` failure is constructed through. */
export const UnreadErrors = {
  adoptDigestStale: ({ approved, current }: { approved: string; current: string }): AdoptDigestStaleError => ({
    code: "ADOPT_DIGEST_STALE",
    message:
      `the approved digest ${approved} is not this read's ${current}: the backlog, the cursor or the instant moved ` +
      "since the preview, so nothing was adopted — preview again and approve what it prints",
  }),
  callPrefixChanged: ({ callId, why }: { callId: string; why: string }): CallPrefixChangedError => ({
    callId,
    code: "CALL_PREFIX_CHANGED",
    message:
      `call ${callId}'s file no longer holds what the talk unread cursor last read — ${why}; ` +
      "a call file is append-only, so something rewrote it and nothing past the cursor can be trusted as read",
  }),
  callFileGone: ({ callId }: { callId: string }): CallFileGoneError => ({
    callId,
    code: "CALL_FILE_GONE",
    message:
      `call ${callId}'s file is no longer in the calls directory, though the talk unread cursor read it or the call index ` +
      "records it; nothing in Slopweaver deletes a call file, so its unread words are refused rather than read as none — " +
      "find what removed it, restore it if any copy exists, else accept the loss on the record: " +
      `slopweaver talk quarantine ${callId} --reason "<what removed it, and whose words they were>"`,
  }),
  quarantineUnreadable: ({ why }: { why: string }): QuarantineUnreadableError => ({
    code: "QUARANTINE_UNREADABLE",
    message: `${why}; no read goes past a gone call while the quarantine ledger cannot be trusted`,
  }),
  callIndexMalformed: ({ path, lineNumber }: { path: string; lineNumber: number }): CallIndexMalformedError => ({
    code: "CALL_INDEX_MALFORMED",
    message:
      `${path} line ${String(lineNumber)} is not a call id; the index names every call so a deleted one is refused, ` +
      "so a damaged one is refused too rather than read as naming fewer calls",
    path,
  }),
  tailUnterminated: ({ path, bytes }: { path: string; bytes: number }): TailUnterminatedError => ({
    code: "TAIL_UNTERMINATED",
    message:
      `${path} ends in ${String(bytes)} byte(s) with no newline, which may be the owner's words: a write still landing, so run ` +
      "it again in a moment — or, if it persists, one that died mid-line, and the file needs repair before a word " +
      "past it can be read or a tick recorded",
    path,
  }),
  cursorMalformed: ({ path, why }: { path: string; why: string }): CursorMalformedError => ({
    code: "CURSOR_MALFORMED",
    message: `${path} is not a talk unread cursor — ${why}; it is refused rather than read as no cursor at all`,
    path,
  }),
  cursorInstallFailed: ({
    path,
    recordPath,
    cause,
  }: {
    path: string;
    recordPath: string;
    cause: unknown;
  }): CursorInstallFailedError => ({
    cause,
    code: "CURSOR_INSTALL_FAILED",
    message:
      `${path} did not move — its staged write failed to install (${cause instanceof Error ? cause.message : String(cause)}) ` +
      `after its record was stored in ${recordPath}; that record names a move that did not happen, and nothing ` +
      "passed unrecorded",
    path,
    recordPath,
  }),
  cursorMoved: ({ path, why }: { path: string; why: string }): CursorMovedError => ({
    code: "CURSOR_MOVED",
    message: `${path} was not written — ${why}; nothing is recorded as read, so run it again to read and print afresh`,
    path,
  }),
  cursorNameInvalid: ({ name }: { name: string }): CursorNameInvalidError => ({
    code: "CURSOR_NAME_INVALID",
    message:
      `cursor name ${JSON.stringify(name)} is not usable: lowercase letters, digits and hyphens only, ` +
      "starting with a letter or digit, at most 64 characters",
    name,
  }),
  partBeyondLine: ({ callId, printed, of }: { callId: string; printed: number; of: number }): PartBeyondLineError => ({
    callId,
    code: "PART_BEYOND_LINE",
    message:
      `the talk unread cursor says ${String(printed)} part(s) of call ${callId}'s next line were printed, and it has ` +
      `${String(of)} — no mark writes that, so it is refused rather than read as the line nearly done`,
  }),
  pathFailed: ({ path, cause }: { path: string; cause: unknown }): UnreadPathFailedError => ({
    cause,
    code: "UNREAD_PATH_FAILED",
    message: `could not read or write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
