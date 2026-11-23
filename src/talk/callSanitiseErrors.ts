/**
 * Why `talk transcript` refused to append a batch it had read: the private denylist could not be read, so nothing
 * could be masked against it, or a secret was still on a line after masking. Both are retried by the console (the
 * verb exits `EXIT_ERROR`), since neither is the batch being malformed.
 */

/** The private denylist was there but could not be read, so the batch could not be masked against it. */
export interface CallDenylistUnreadableError {
  readonly code: "CALL_DENYLIST_UNREADABLE";
  readonly message: string;
}

/** A line still carried a secret after masking, or masking left it a line the call file cannot hold. */
export interface CallSanitiseFailedError {
  readonly code: "CALL_SANITISE_FAILED";
  readonly message: string;
  /** The secret classes still on the line; empty when masking broke the line's shape instead. */
  readonly labels: readonly string[];
}

/** Why a read batch was not appended. */
export type CallSanitiseError = CallDenylistUnreadableError | CallSanitiseFailedError;

export const CallSanitiseErrors = {
  denylistUnreadable: ({ why }: { why: string }): CallDenylistUnreadableError => ({
    code: "CALL_DENYLIST_UNREADABLE",
    message: `nothing appended: ${why}`,
  }),
  secretSurvived: ({ kind, labels }: { kind: string; labels: readonly string[] }): CallSanitiseFailedError => ({
    code: "CALL_SANITISE_FAILED",
    labels: [...labels],
    message: `nothing appended: a ${kind} line still carried ${labels.join(", ")} after masking`,
  }),
  shapeBroken: ({ kind }: { kind: string }): CallSanitiseFailedError => ({
    code: "CALL_SANITISE_FAILED",
    labels: [],
    message: `nothing appended: masking a secret out of a ${kind} line left it a line the call file cannot hold`,
  }),
} as const;
