/**
 * Typed domain errors for listener supervision — see `.claude/rules/error-handling.md` for the shape.
 *
 * Two independent unions, one per bounded concern: reading/writing the durable supervision state
 * ({@link ListenerStateError}), and planning an arm ({@link ListenerArmError}). They share no base type,
 * matching the four unions already in `../errors.ts`.
 *
 * The second union has exactly one variant, and that is the shape rather than an unfinished one: planning an
 * arm STARTS nothing (see `./arm.ts`), so the only way it can fail is by finding a live listener already
 * registered. It stays a union because a caller branches on `code` to tell it apart from a state-read
 * failure, which is a genuinely different outcome with a genuinely different fix.
 *
 * The state union deliberately keeps `unreadable` apart from `malformed` and from a missing file, the same
 * three-outcome split `recoverScheduleStore.ts` documents: a supervisor that cannot tell "never armed" from
 * "the pidfile is corrupt" will happily start a SECOND listener beside a live one, and Slack load-balances a
 * tag across two Socket Mode connections — only one of which answers.
 */

/** The supervision state file exists but could not be read — a real I/O fault, never "never armed". */
export interface ListenerStateUnreadableError {
  readonly code: "LISTENER_STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** The supervision state file is not parseable JSON. */
export interface ListenerStateMalformedJsonError {
  readonly code: "LISTENER_STATE_MALFORMED_JSON";
  readonly message: string;
  readonly path: string;
}

/** The decoded value does not match the arm-record schema. */
export interface ListenerStateInvalidError {
  readonly code: "LISTENER_STATE_INVALID";
  readonly message: string;
  readonly field: string;
}

/** Writing the supervision state failed. */
export interface ListenerStateWriteFailedError {
  readonly code: "LISTENER_STATE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every failure the supervision state store can produce. */
export type ListenerStateError =
  | ListenerStateUnreadableError
  | ListenerStateMalformedJsonError
  | ListenerStateInvalidError
  | ListenerStateWriteFailedError;

/** Factories for every {@link ListenerStateError} variant. */
export const ListenerStateErrors = {
  /** @returns a {@link ListenerStateInvalidError} naming the field that did not match */
  invalid: ({ field, found }: { field: string; found: unknown }): ListenerStateInvalidError => ({
    code: "LISTENER_STATE_INVALID",
    field,
    message: `listener supervision state field "${field}" is invalid: ${JSON.stringify(found)}`,
  }),
  /** @returns a {@link ListenerStateMalformedJsonError} naming the unparseable file */
  malformedJson: ({ path }: { path: string }): ListenerStateMalformedJsonError => ({
    code: "LISTENER_STATE_MALFORMED_JSON",
    message: `listener supervision state at ${path} is not parseable JSON; refusing rather than treating it as unarmed`,
    path,
  }),
  /** @returns a {@link ListenerStateUnreadableError} carrying the underlying I/O cause */
  unreadable: ({ path, cause }: { path: string; cause: unknown }): ListenerStateUnreadableError => ({
    cause,
    code: "LISTENER_STATE_UNREADABLE",
    message: `listener supervision state at ${path} could not be read`,
    path,
  }),
  /** @returns a {@link ListenerStateWriteFailedError} carrying the underlying I/O cause */
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): ListenerStateWriteFailedError => ({
    cause,
    code: "LISTENER_STATE_WRITE_FAILED",
    message: `listener supervision state at ${path} could not be written`,
    path,
  }),
} as const;

/** An arm was refused because a live listener is already registered. */
export interface ListenerAlreadyArmedError {
  readonly code: "LISTENER_ALREADY_ARMED";
  readonly message: string;
  readonly pid: number;
  readonly armId: string;
}

/** Every failure planning an arm can produce — exactly one, because planning starts nothing. */
export type ListenerArmError = ListenerAlreadyArmedError;

/** Factories for every {@link ListenerArmError} variant. */
export const ListenerArmErrors = {
  /** @returns a {@link ListenerAlreadyArmedError} naming the live arm that blocked this one */
  alreadyArmed: ({ armId, pid }: { armId: string; pid: number }): ListenerAlreadyArmedError => ({
    armId,
    code: "LISTENER_ALREADY_ARMED",
    message:
      `listener arm ${armId} is already live at pid ${String(pid)} — refusing to arm a second one; ` +
      "Slack load-balances a tag across two Socket Mode connections and only one would answer",
    pid,
  }),
} as const;
