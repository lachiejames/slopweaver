/**
 * Every way one `writeGit` child — a push, a fetch, a ref write over the transport — ends without success. One
 * union for this one domain, per `.claude/rules/error-handling.md`; `writeGit`'s callers still read the message,
 * and `code` is what tells a child stopped at its bound from one the remote refused.
 */

/** The child was still running at its bound and was killed, so the transfer did not complete. */
export interface GitWriteTimedOutError {
  readonly code: "GIT_WRITE_TIMED_OUT";
  readonly message: string;
  readonly timeoutMs: number;
}

/** The child could not be started, or Node reported another launch failure. */
export interface GitWriteUnrunnableError {
  readonly code: "GIT_WRITE_UNRUNNABLE";
  readonly message: string;
}

/** A signal other than the bound's ended the child before it gave an exit status. */
export interface GitWriteKilledError {
  readonly code: "GIT_WRITE_KILLED";
  readonly message: string;
  readonly signal: string;
}

/** The child exited non-zero: git itself, or the remote through it, refused. */
export interface GitWriteExitedError {
  readonly code: "GIT_WRITE_EXITED";
  readonly message: string;
  readonly status: number;
}

/** Every `writeGit` failure. */
export type GitWriteError = GitWriteTimedOutError | GitWriteUnrunnableError | GitWriteKilledError | GitWriteExitedError;

/** Constructors for {@link GitWriteError}. */
export const GitWriteErrors = {
  exited: ({ status }: { status: number }): GitWriteExitedError => ({
    code: "GIT_WRITE_EXITED",
    message: `git exited ${String(status)}`,
    status,
  }),
  // A null status means a SIGNAL killed git, and the signal is the only thing that says which. Measured:
  // three pushes in a row reported "git exited without a status" with a green pre-push gate and
  // a demonstrably working transport, and the message named nothing to act on — the reason a diagnosis took
  // three nine-minute runs was this sentence, not the fault.
  killed: ({ signal }: { signal: string }): GitWriteKilledError => ({
    code: "GIT_WRITE_KILLED",
    message:
      `git was killed by ${signal} — the push did not complete, and this is not a rejection by the remote. ` +
      "A SIGPIPE here means the transport died mid-push, or the session's own stdout closed under git. " +
      "The pre-push gate has already run before this point (see pushAndVerify), so an idle-connection reset " +
      "across the gate is not the cause; look for `closed by remote host` or `Connection reset` above.",
    signal,
  }),
  timedOut: ({ timeoutMs }: { timeoutMs: number }): GitWriteTimedOutError => ({
    code: "GIT_WRITE_TIMED_OUT",
    message:
      `git was still running after ${String(timeoutMs / 60_000)} minutes, so it was stopped — the ` +
      "transfer did not complete, and this is not a rejection by the remote. Look above for a prompt it was " +
      "waiting on (an ssh passphrase, a credential helper), or a transport that stopped moving.",
    timeoutMs,
  }),
  unrunnable: ({ cause }: { cause: string }): GitWriteUnrunnableError => ({
    code: "GIT_WRITE_UNRUNNABLE",
    message: cause,
  }),
} as const;
