/**
 * Why an app-hosted Claude worker refused to start, or stopped: one discriminated union, scoped to this worker.
 */

/** The SDK asked to start a program other than the packaged Claude Code binary the launch named. */
export interface ExecutableMismatchError {
  readonly code: "EXECUTABLE_MISMATCH";
  readonly message: string;
}

/** The SDK asked to start Claude Code somewhere other than the session's directory. */
export interface DirectoryMismatchError {
  readonly code: "DIRECTORY_MISMATCH";
  readonly message: string;
}

/** A setup-token seat's token file could not be opened, and nothing else may stand in for it. */
export interface TokenUnreadableError {
  readonly code: "TOKEN_UNREADABLE";
  readonly message: string;
}

/** The session opened on an account the plan did not route it to. */
export interface AccountRefusedError {
  readonly code: "ACCOUNT_REFUSED";
  readonly message: string;
}

/** Any failure of an app-hosted Claude worker. */
export type ClaudeWorkerError =
  ExecutableMismatchError | DirectoryMismatchError | TokenUnreadableError | AccountRefusedError;

/** The factories, so every message is worded once. */
export const ClaudeWorkerErrors = {
  accountRefused: ({ why }: { why: string }): AccountRefusedError => ({ code: "ACCOUNT_REFUSED", message: why }),
  directoryMismatch: ({ asked, launched }: { asked: string; launched: string }): DirectoryMismatchError => ({
    code: "DIRECTORY_MISMATCH",
    message: `the Agent SDK asked to start Claude Code in ${asked}, not the session's ${launched}`,
  }),
  executableMismatch: ({ asked, launched }: { asked: string; launched: string }): ExecutableMismatchError => ({
    code: "EXECUTABLE_MISMATCH",
    message: `the Agent SDK asked to start ${asked}, not the packaged Claude Code at ${launched}`,
  }),
  tokenUnreadable: ({ path, cause }: { path: string; cause: unknown }): TokenUnreadableError => ({
    code: "TOKEN_UNREADABLE",
    message: `the seat's setup token at ${path} could not be opened (${cause instanceof Error ? cause.message : String(cause)}), and no other login may stand in for it`,
  }),
} as const;
