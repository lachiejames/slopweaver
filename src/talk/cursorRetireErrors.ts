/**
 * Every way `slopweaver talk cursor-retire` refuses to retire a reader's cursor — its own union, because each names a
 * different next step: a healthy or absent cursor needs nothing, a gone call file needs `talk quarantine`, a moved
 * cursor needs a fresh preview.
 */

/** No cursor file stands for the reader: there is nothing to retire, and `talk unread` reads as a first read. */
export interface CursorRetireAbsentError {
  readonly code: "CURSOR_RETIRE_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The cursor reads and every call it names proves its prefix: it is trusted, so it stays. */
export interface CursorRetireHealthyError {
  readonly code: "CURSOR_RETIRE_HEALTHY";
  readonly message: string;
  readonly path: string;
}

/** `talk unread` fails for a reason retiring the cursor does not answer — a gone call file, a tail still landing. */
export interface CursorRetireNotRetirableError {
  readonly code: "CURSOR_RETIRE_NOT_RETIRABLE";
  readonly message: string;
  /** The `talk unread` failure code that refused. */
  readonly unreadCode: string;
}

/** The cursor file's digest is not the one the preview printed: it moved, so the preview no longer describes it. */
export interface CursorRetireSourceMovedError {
  readonly code: "CURSOR_RETIRE_SOURCE_MOVED";
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
}

/** The cursor's lock is held by another write — a mark in flight. */
export interface CursorRetireLockHeldError {
  readonly code: "CURSOR_RETIRE_LOCK_HELD";
  readonly message: string;
}

/** A path could not be read, created or moved. */
export interface CursorRetireIoError {
  readonly code: "CURSOR_RETIRE_IO";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way `talk cursor-retire` refuses. */
export type CursorRetireError =
  | CursorRetireAbsentError
  | CursorRetireHealthyError
  | CursorRetireNotRetirableError
  | CursorRetireSourceMovedError
  | CursorRetireLockHeldError
  | CursorRetireIoError;

/** The factories every `talk cursor-retire` refusal is constructed through. */
export const CursorRetireErrors = {
  absent: ({ path }: { path: string }): CursorRetireAbsentError => ({
    code: "CURSOR_RETIRE_ABSENT",
    message: `${path} does not exist, so there is no cursor to retire; talk unread reads as a first read`,
    path,
  }),
  healthy: ({ path }: { path: string }): CursorRetireHealthyError => ({
    code: "CURSOR_RETIRE_HEALTHY",
    message:
      `${path} reads and every call it names proves the bytes it read, so it is trusted and stays; ` +
      "only a cursor talk unread refuses with CALL_PREFIX_CHANGED or CURSOR_MALFORMED is retired",
    path,
  }),
  notRetirable: ({ unreadCode, why }: { unreadCode: string; why: string }): CursorRetireNotRetirableError => ({
    code: "CURSOR_RETIRE_NOT_RETIRABLE",
    message:
      `talk unread refuses with ${unreadCode}, which retiring the cursor does not answer — ${why}; ` +
      "only CALL_PREFIX_CHANGED or CURSOR_MALFORMED is retired",
    unreadCode,
  }),
  sourceMoved: ({ expected, actual }: { expected: string; actual: string }): CursorRetireSourceMovedError => ({
    actual,
    code: "CURSOR_RETIRE_SOURCE_MOVED",
    expected,
    message:
      `the cursor's sha256 is ${actual}, not the ${expected} the preview printed — it moved since, ` +
      "so nothing was retired; preview again with slopweaver talk cursor-retire",
  }),
  lockHeld: ({ why }: { why: string }): CursorRetireLockHeldError => ({
    code: "CURSOR_RETIRE_LOCK_HELD",
    message: `the cursor's lock is held, so nothing was retired — ${why}; run it again in a moment`,
  }),
  io: ({ path, cause }: { path: string; cause: unknown }): CursorRetireIoError => ({
    cause,
    code: "CURSOR_RETIRE_IO",
    message: `could not read, create or move ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
