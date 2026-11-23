/**
 * Every failure `slopweaver github lap` authors, as one discriminated union and its factory
 * (`.claude/rules/error-handling.md`). Callers display `message`; a test or a branch reads `code`.
 */

/** The preflight judged the pull request unlandable, or could not read what it judges from. */
export interface LapRefusedError {
  readonly code: "REFUSED";
  readonly message: string;
}

/**
 * GitHub denied the token a read of the base branch's protection. Its own member rather than a `REFUSED`, so a
 * real permission denial never reads like the plan-gated 403 the lap proceeds past.
 */
export interface LapProtectionPermissionDeniedError {
  readonly code: "PROTECTION_PERMISSION_DENIED";
  readonly message: string;
}

/** A git or docker command the lap shells failed or timed out. */
export interface LapCommandFailedError {
  readonly code: "COMMAND_FAILED";
  readonly message: string;
}

/**
 * Another live lap holds the machine, or the lock could not be taken at all — or a seat's compile kept the machine's
 * TypeScript compile lease past the lap's wait, or that lease could not be taken (`./lapCompileLease.ts`).
 */
export interface LapLockError {
  readonly code: "LOCK_HELD" | "LOCK_UNAVAILABLE" | "COMPILE_LEASE_HELD" | "COMPILE_LEASE_UNAVAILABLE";
  readonly message: string;
}

/** The throwaway store would not start, published no port, or never accepted connections. */
export interface LapStoreError {
  readonly code: "STORE_UNAVAILABLE";
  readonly message: string;
}

/** A commit status could not be posted, or was not read back as posted. */
export interface LapPostError {
  readonly code: "POST_FAILED";
  readonly message: string;
}

/** Every failure the lap authors. */
export type LapError =
  | LapRefusedError
  | LapProtectionPermissionDeniedError
  | LapCommandFailedError
  | LapLockError
  | LapStoreError
  | LapPostError;

export const LapErrors = {
  compileLeaseHeld: ({ holder, waitedSeconds }: { holder: string; waitedSeconds: number }): LapLockError => ({
    code: "COMPILE_LEASE_HELD",
    message:
      `the machine's TypeScript compile lease is still ${holder} after ${String(waitedSeconds)}s of waiting. ` +
      "One compile at a time, because a whole-repo type pass beside a lap runs the machine out of memory; run again once it finishes",
  }),
  compileLeaseUnavailable: ({ cause }: { cause: string }): LapLockError => ({
    code: "COMPILE_LEASE_UNAVAILABLE",
    message: `could not take the machine's TypeScript compile lease: ${cause}`,
  }),
  commandFailed: ({ command, cause }: { command: string; cause: string }): LapCommandFailedError => ({
    code: "COMMAND_FAILED",
    message: `${command} failed: ${cause}`,
  }),
  lockHeld: ({
    subject,
    pid,
    startedIso,
    phase,
  }: {
    subject: string;
    pid: number;
    startedIso: string;
    /** The holder's phase in words (`lapLockPhaseWords`). */
    phase: string;
  }): LapLockError => ({
    code: "LOCK_HELD",
    message:
      `another lap holds this machine: ${subject}, pid ${String(pid)}, since ${startedIso}, ${phase}. ` +
      "One lap at a time, because two would each starve the other into timeouts; run again once it finishes",
  }),
  lockUnavailable: ({ path, cause }: { path: string; cause: string }): LapLockError => ({
    code: "LOCK_UNAVAILABLE",
    message: `could not take the lap lock at ${path}: ${cause}`,
  }),
  postFailed: ({ what }: { what: string }): LapPostError => ({ code: "POST_FAILED", message: what }),
  protectionPermissionDenied: ({ denial }: { denial: string }): LapProtectionPermissionDeniedError => ({
    code: "PROTECTION_PERMISSION_DENIED",
    message: `the lap will not run: ${denial}`,
  }),
  refused: ({ reason }: { reason: string }): LapRefusedError => ({ code: "REFUSED", message: reason }),
  storeUnavailable: ({ why }: { why: string }): LapStoreError => ({
    code: "STORE_UNAVAILABLE",
    message: `the lap's throwaway store ${why}`,
  }),
} as const;
