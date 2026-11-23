/**
 * Every way a call-thread journal read or write fails (`./callThreadStore.ts`), one union for the journal alone: a
 * call file's failures are `./errors.ts`'s, and the two never share a type. A caller branches on `code` — the append
 * verb answers a refused batch `EXIT_USAGE` so the console stops retrying it, and a failed write `EXIT_ERROR` so it
 * tries again.
 */

/** The call id is not a v4 UUID, so it names no journal. */
export interface CallThreadCallInvalidError {
  readonly code: "CALL_THREAD_CALL_INVALID";
  readonly message: string;
  readonly callId: string;
}

/** A batch the console staged did not parse as journal entries: refused whole, so retrying it cannot help. */
export interface CallThreadBatchInvalidError {
  readonly code: "CALL_THREAD_BATCH_INVALID";
  readonly message: string;
  readonly path: string;
}

/** The private denylist exists and could not be read, so no entry can be masked against it. */
export interface CallThreadDenylistUnreadableError {
  readonly code: "CALL_THREAD_DENYLIST_UNREADABLE";
  readonly message: string;
}

/** A secret survived even the withheld stand-in, so nothing of the batch is written. */
export interface CallThreadSecretSurvivedError {
  readonly code: "CALL_THREAD_SECRET_SURVIVED";
  readonly message: string;
  readonly labels: readonly string[];
}

/**
 * An entry's `writeId` is already in the journal on a DIFFERENT line, so it is not a retry of what was written: a
 * repeated id proves nothing about this capture, and taking it as written would drop the capture without a word.
 */
export interface CallThreadWriteIdCollisionError {
  readonly code: "CALL_THREAD_WRITE_ID_COLLISION";
  readonly message: string;
  readonly writeId: string;
}

/** A journal file or its directory could not be read or written. */
export interface CallThreadPathFailedError {
  readonly code: "CALL_THREAD_PATH_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * A journal path is a symlink, a hard link, or anything but a regular file with one link — or a directory above it is
 * a symlink: written through, it would land in a file the call's own lock does not guard, perhaps another call's
 * journal or one outside this home, so it is refused.
 */
export interface CallThreadNotAFileError {
  readonly code: "CALL_THREAD_NOT_A_FILE";
  readonly message: string;
  readonly path: string;
}

/** No journal is on disk for the call: a typo and a call that recorded nothing must not read the same. */
export interface CallThreadMissingError {
  readonly code: "CALL_THREAD_MISSING";
  readonly message: string;
  readonly callId: string;
}

/** Every call-thread journal failure. */
export type CallThreadError =
  | CallThreadCallInvalidError
  | CallThreadBatchInvalidError
  | CallThreadDenylistUnreadableError
  | CallThreadSecretSurvivedError
  | CallThreadWriteIdCollisionError
  | CallThreadPathFailedError
  | CallThreadNotAFileError
  | CallThreadMissingError;

/** The factories every {@link CallThreadError} is built through. */
export const CallThreadErrors = {
  batchInvalid: ({ path, why }: { path: string; why: string }): CallThreadBatchInvalidError => ({
    code: "CALL_THREAD_BATCH_INVALID",
    message: `the call-thread batch at ${path} is refused: ${why}`,
    path,
  }),
  callInvalid: ({ callId }: { callId: string }): CallThreadCallInvalidError => ({
    callId,
    code: "CALL_THREAD_CALL_INVALID",
    message: `${JSON.stringify(callId)} is not a call id (a v4 UUID)`,
  }),
  denylistUnreadable: ({ message }: { message: string }): CallThreadDenylistUnreadableError => ({
    code: "CALL_THREAD_DENYLIST_UNREADABLE",
    message,
  }),
  missing: ({ callId, path }: { callId: string; path: string }): CallThreadMissingError => ({
    callId,
    code: "CALL_THREAD_MISSING",
    message: `no call-thread journal for call ${callId} at ${path}`,
  }),
  notAFile: ({ path }: { path: string }): CallThreadNotAFileError => ({
    code: "CALL_THREAD_NOT_A_FILE",
    message: `${path} is a link, or not a regular file with one link, so the call-thread journal is not read or written through it`,
    path,
  }),
  pathFailed: ({ cause, path }: { cause: unknown; path: string }): CallThreadPathFailedError => ({
    cause,
    code: "CALL_THREAD_PATH_FAILED",
    message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  secretSurvived: ({ labels }: { labels: readonly string[] }): CallThreadSecretSurvivedError => ({
    code: "CALL_THREAD_SECRET_SURVIVED",
    labels,
    message: `a ${labels.join(", ")} hit survived masking and the withheld stand-in, so the batch is not written`,
  }),
  writeIdCollision: ({ writeId }: { writeId: string }): CallThreadWriteIdCollisionError => ({
    code: "CALL_THREAD_WRITE_ID_COLLISION",
    message: `writeId ${writeId} is already in the journal on a different entry, so the batch is not written`,
    writeId,
  }),
} as const;
