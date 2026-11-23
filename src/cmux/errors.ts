/**
 * The cmux control-socket domain's typed errors.
 *
 * `TERMINAL_TEXT_UNREADABLE` is its own variant rather than a substring match on a message, and that is the
 * whole reason this union exists. Measured repeatedly in this repository (`spawn.ts`'s own header, and
 * Finding 2 of `recipe-scheduler-per-recipe-concurrency`): a surface still settling under concurrent load
 * answers a screen read with `internal_error: Failed to read terminal text`, and callers used to distinguish
 * that TRANSIENT condition from a real fault by looking for that English sentence inside a thrown message.
 * A caller that must retry-or-give-up on exactly one condition needs a `code` to branch on, not a phrase a
 * cmux release is free to reword.
 */

/**
 * Why the socket would not serve: cmux's `cmuxOnly` access layer turned this process away
 * (`access-denied` — a process cmux did not start and that holds no capability token, which no reconnect
 * changes), or the transport itself failed (no socket, a refused connect, a reset, a close, any other refusal).
 */
type CmuxSocketUnavailableReason = "access-denied" | "transport-unavailable";

/** cmux is not reachable at all: no socket path resolved, or the connection was refused. */
export interface CmuxSocketUnavailableError {
  readonly code: "SOCKET_UNAVAILABLE";
  readonly reason: CmuxSocketUnavailableReason;
  readonly message: string;
  readonly socketPath: string | undefined;
  readonly cause?: unknown;
}

/** cmux answered the call with its own `{code, message}` error frame. */
export interface CmuxCallFailedError {
  readonly code: "CALL_FAILED";
  readonly message: string;
  readonly method: string;
  readonly cmuxCode: string;
}

/**
 * The one transient cmux answers a screen read with while a surface is still settling — see this module's
 * own header for why it is a variant and not a string match.
 */
export interface CmuxTerminalTextUnreadableError {
  readonly code: "TERMINAL_TEXT_UNREADABLE";
  readonly message: string;
  readonly method: string;
}

/** The call was sent but no reply frame arrived inside the bound. */
export interface CmuxTimeoutError {
  readonly code: "TIMEOUT";
  readonly message: string;
  readonly method: string;
  readonly timeoutMs: number;
}

/** A reply arrived but did not carry the shape this client requires of it. */
export interface CmuxMalformedReplyError {
  readonly code: "MALFORMED_REPLY";
  readonly message: string;
  readonly method: string;
}

/** Every way a cmux control-socket call can fail. */
export type CmuxError =
  | CmuxSocketUnavailableError
  | CmuxCallFailedError
  | CmuxTerminalTextUnreadableError
  | CmuxTimeoutError
  | CmuxMalformedReplyError;

/**
 * Whether a failed keystroke call may still have been applied: the connection was lost, the call timed out, or
 * a reply arrived that could not be read. cmux may have typed it before its reply went missing, which is why the
 * socket never replays one (`./socket.ts`). A refusal cmux answered in its own frame, and an access refusal before
 * any call, both say it was not.
 *
 * @param error the failure a keystroke call returned
 * @returns `true` when the keystroke may have landed, `false` when cmux said it did not
 */
export function keystrokeMayHaveLanded({ error }: { error: CmuxError }): boolean {
  return (
    error.code === "TIMEOUT" ||
    error.code === "MALFORMED_REPLY" ||
    (error.code === "SOCKET_UNAVAILABLE" && error.reason === "transport-unavailable")
  );
}

/**
 * Whether cmux simply did not answer in time — the client's own bound ran out (`TIMEOUT`), or cmux answered with
 * its own `timeout` frame ("cmux did not respond within 10 seconds, so the command was not run. Retry in a
 * moment."). Both say nothing about the state asked for, only that asking again later is the move. Matched on
 * the code, never the English. MEASURED: the hourly `worktree-prune` row's firing got the
 * second shape from `workspace.list` and was held as a broken integration (board row
 * `recipe-failing-worktree-prune-2026-11-07t20-00-00.000z-a1`).
 *
 * @param error the failure a call returned
 * @returns `true` only for a call cmux never answered in time
 */
export function cmuxDidNotAnswer({ error }: { error: CmuxError }): boolean {
  return error.code === "TIMEOUT" || (error.code === "CALL_FAILED" && error.cmuxCode === "timeout");
}

/**
 * Whether a failed `workspace.close` was cmux 0.65.2's running-process confirmation rather than a real failure —
 * `confirmation_required`, "Workspace has a running process; retry with --force", which an idle `claude` at its
 * prompt triggers. Matched on cmux's own code, never its English.
 *
 * @param error the failure a close returned
 * @returns `true` only for that one refusal of that one method
 */
export function isWorkspaceCloseConfirmationRequired({ error }: { error: CmuxError }): boolean {
  return (
    error.code === "CALL_FAILED" && error.method === "workspace.close" && error.cmuxCode === "confirmation_required"
  );
}

/** The factory every producer of a {@link CmuxError} constructs through — tests included. */
export const CmuxErrors = {
  /**
   * cmux's `cmuxOnly` refusal of a process it did not start (`./socketFrames.ts`'s `isAccessDeniedRefusal`).
   * The message keeps cmux's own words, already redacted of any capability by the frame reader.
   */
  accessDenied: ({
    socketPath,
    refusal,
  }: {
    socketPath: string | undefined;
    refusal: string;
  }): CmuxSocketUnavailableError => ({
    code: "SOCKET_UNAVAILABLE",
    message: `cmux control socket unavailable${socketPath === undefined ? "" : ` at ${socketPath}`}: cmux refused the connection: ${refusal}`,
    reason: "access-denied",
    socketPath,
  }),
  callFailed: ({
    method,
    cmuxCode,
    message,
  }: {
    method: string;
    cmuxCode: string;
    message: string;
  }): CmuxCallFailedError => ({
    cmuxCode,
    code: "CALL_FAILED",
    message: `cmux ${method} failed (${cmuxCode}): ${message}`,
    method,
  }),
  malformedReply: ({ method, detail }: { method: string; detail: string }): CmuxMalformedReplyError => ({
    code: "MALFORMED_REPLY",
    message: `cmux ${method} replied with an unusable shape: ${detail}`,
    method,
  }),
  socketUnavailable: ({
    socketPath,
    detail,
    cause,
  }: {
    socketPath: string | undefined;
    detail: string;
    cause?: unknown;
  }): CmuxSocketUnavailableError => ({
    ...(cause === undefined ? {} : { cause }),
    code: "SOCKET_UNAVAILABLE",
    message: `cmux control socket unavailable${socketPath === undefined ? "" : ` at ${socketPath}`}: ${detail}`,
    reason: "transport-unavailable",
    socketPath,
  }),
  terminalTextUnreadable: ({
    method,
    detail,
  }: {
    method: string;
    detail: string;
  }): CmuxTerminalTextUnreadableError => ({
    code: "TERMINAL_TEXT_UNREADABLE",
    message: `cmux ${method} could not read the terminal text (transient, the surface is still settling): ${detail}`,
    method,
  }),
  timedOut: ({ method, timeoutMs }: { method: string; timeoutMs: number }): CmuxTimeoutError => ({
    code: "TIMEOUT",
    message: `cmux ${method} did not answer within ${String(timeoutMs)}ms`,
    method,
    timeoutMs,
  }),
} as const;
