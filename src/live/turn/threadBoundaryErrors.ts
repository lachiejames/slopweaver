/**
 * The typed failures of the send-time thread boundary — a caller's claimed read that cannot be true.
 *
 * Its own union rather than three more plain strings on `src/live/turn`'s list, which is what
 * `error-shape-threshold` asks of a directory already past the threshold, and what
 * `.claude/rules/error-handling.md` prescribes for genuinely distinct failure kinds. The three are distinct:
 * a value that is not a timestamp at all is a caller typo, a boundary before the ask is a caller who has the
 * direction backwards, and a boundary past the thread's tail is a claimed read that could not have happened
 * — the only one of the three that could silence the gate rather than tighten it.
 *
 * Every variant carries `message`, which is what `turn answer` displays; nothing branches on `code` yet, and
 * the codes exist so that something can without re-parsing prose.
 */

/** `--read-through` was not a Slack message timestamp at all. */
export interface BoundaryNotATimestampError {
  readonly code: "BOUNDARY_NOT_A_TIMESTAMP";
  readonly message: string;
  readonly given: string;
}

/** `--read-through` sat at or before the message being answered, which would widen the window. */
export interface BoundaryBeforeAskError {
  readonly code: "BOUNDARY_BEFORE_ASK";
  readonly message: string;
  readonly given: string;
  readonly addressedTs: string;
}

/** `--read-through` sat past the thread's own newest message — a read that cannot have been taken. */
export interface BoundaryAfterThreadError {
  readonly code: "BOUNDARY_AFTER_THREAD";
  readonly message: string;
  readonly given: string;
  readonly newestTs: string;
}

/** Every way a claimed read boundary can be refused. */
export type ThreadBoundaryError = BoundaryNotATimestampError | BoundaryBeforeAskError | BoundaryAfterThreadError;

/** The factory the real code calls, so a test builds a fixture the same way the code does. */
export const ThreadBoundaryErrors = {
  afterThread: ({ given, newestTs }: { given: string; newestTs: string }): BoundaryAfterThreadError => ({
    code: "BOUNDARY_AFTER_THREAD",
    given,
    message: `--read-through ${given} is later than the thread's newest message (${newestTs}) — that is a read this answer cannot have taken`,
    newestTs,
  }),
  beforeAsk: ({ addressedTs, given }: { addressedTs: string; given: string }): BoundaryBeforeAskError => ({
    addressedTs,
    code: "BOUNDARY_BEFORE_ASK",
    given,
    message: `--read-through ${given} is at or before the message being answered (${addressedTs}) — it may only move the boundary forward, never widen it`,
  }),
  notATimestamp: ({ given }: { given: string }): BoundaryNotATimestampError => ({
    code: "BOUNDARY_NOT_A_TIMESTAMP",
    given,
    message: `--read-through is not a Slack message timestamp: ${given}`,
  }),
} as const;
