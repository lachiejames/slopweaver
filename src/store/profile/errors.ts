/**
 * Curating a profile fails in ways a caller branches on, so it carries its own union.
 *
 * Four kinds, and each one leads somewhere different. `PROFILE_ABSENT` tells a fresh install to seed
 * rather than that anything broke. `REVISION_CONFLICT` tells a curator to re-read and redo their edit,
 * never to retry the same write. `PAYLOAD_INVALID` names the Zod issues so a hand-written file can be
 * fixed. `PROFILE_QUERY_FAILED` is the boundary: a {@link ../errors.StoreError} mapped in at the exact
 * point it is caught, carrying its message forward rather than discarding it, per `error-handling.md`.
 */
import type { StoreError } from "../errors.js";

/** The row this read needs has never been written. Not a failure on a fresh install — an invitation. */
export interface ProfileAbsentError {
  readonly code: "PROFILE_ABSENT";
  readonly message: string;
  /** What was looked for: `owner`, or a person's id. */
  readonly subject: string;
}

/**
 * The row moved since it was read, so the write was refused and nothing changed.
 *
 * An optimistic write rather than a lock, for the reason the handover board uses the same shape: a lock
 * held by a session that dies is worse than a write that has to be redone, and a curator who re-reads
 * sees what the other writer actually said instead of overwriting it unseen.
 */
export interface ProfileConflictError {
  readonly code: "REVISION_CONFLICT";
  readonly message: string;
  readonly subject: string;
  /** The revision the caller pinned to. */
  readonly expected: number;
  /** The revision the row actually carries now. */
  readonly actual: number;
}

/** A payload did not match its schema, and says every issue rather than the first. */
export interface ProfilePayloadInvalidError {
  readonly code: "PAYLOAD_INVALID";
  readonly message: string;
  /** Every Zod issue, one per line, so a hand-edited file can be fixed in one pass. */
  readonly issues: readonly string[];
}

/** The database refused, failed or could not be reached, with the store's own reason carried forward. */
export interface ProfileQueryFailedError {
  readonly code: "PROFILE_QUERY_FAILED";
  readonly message: string;
  /** The store error underneath, so a caller can still branch on `STORE_URL_MISSING`. */
  readonly cause: StoreError;
}

/** Every way reading or curating a profile can fail. */
export type ProfileError =
  ProfileAbsentError | ProfileConflictError | ProfilePayloadInvalidError | ProfileQueryFailedError;

/** Build one of the four, so a test constructs a failure the same way the real code does. */
export const ProfileErrors = {
  absent: ({ subject }: { subject: string }): ProfileAbsentError => ({
    code: "PROFILE_ABSENT",
    message: `no profile row for ${subject} — nothing has been curated for it yet`,
    subject,
  }),
  conflict: ({
    subject,
    expected,
    actual,
  }: {
    subject: string;
    expected: number;
    actual: number;
  }): ProfileConflictError => ({
    actual,
    code: "REVISION_CONFLICT",
    expected,
    message:
      `${subject} moved from revision ${String(expected)} to ${String(actual)} while this edit was being ` +
      "prepared, so nothing was written. Re-read it and redo the edit on what is there now.",
    subject,
  }),
  payloadInvalid: ({ issues }: { issues: readonly string[] }): ProfilePayloadInvalidError => ({
    code: "PAYLOAD_INVALID",
    issues,
    message: `the payload does not match its schema: ${issues.join("; ")}`,
  }),
  queryFailed: ({ cause }: { cause: StoreError }): ProfileQueryFailedError => ({
    cause,
    code: "PROFILE_QUERY_FAILED",
    message: cause.message,
  }),
} as const;
