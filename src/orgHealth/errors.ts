/**
 * The organisation-health lane's typed failures — one union, scoped to this directory, per
 * `.claude/rules/error-handling.md`.
 *
 * Every variant but the store's own three is a reason the snapshot is written `unmeasurable` rather than `measured`,
 * and a caller branches on the code to say which half broke: the install (no channel configured), the incident
 * system's own shape (a status nobody has mapped, an announcement missing a field), or the read (Slack refused, a
 * thread was incomplete). `STORE_UNAVAILABLE`, `STORED_INVALID` and `REVISION_CONFLICT` are the store's: with the
 * first and the last nothing is known to have been written, so no caller may claim the snapshot now reads anything.
 *
 * Pure: shapes and factories, no I/O.
 */

/** No incident channel is configured for this install, or the profile naming one cannot be read. */
export interface ConfigAbsentError {
  readonly code: "CONFIG_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The config or snapshot file is there and does not decode. */
export interface FileMalformedError {
  readonly code: "FILE_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** The config or snapshot file could not be read or written at all. */
export interface FileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** An incident.io announcement or update is missing a field, or carries two candidates for one. */
export interface AnnouncementMalformedError {
  readonly code: "ANNOUNCEMENT_MALFORMED";
  readonly message: string;
  /** The Slack `ts` of the message that did not parse. */
  readonly ts: string;
}

/** An incident carries a status no phase is mapped for — refused, so a new status word is seen rather than guessed. */
export interface UnknownStatusError {
  readonly code: "UNKNOWN_STATUS";
  readonly message: string;
  readonly status: string;
}

/** An update names a different incident from the announcement it is threaded under. */
export interface RefMismatchError {
  readonly code: "REF_MISMATCH";
  readonly message: string;
  readonly ts: string;
}

/** The read would open more threads than a supervisor tick can afford, so it refused before opening any. */
export interface BudgetExceededError {
  readonly code: "BUDGET_EXCEEDED";
  readonly message: string;
  readonly count: number;
  readonly budget: number;
}

/** The Slack read itself failed or could not be proven complete. */
export interface SlackReadFailedError {
  readonly code: "SLACK_READ_FAILED";
  readonly message: string;
  readonly channelId: string;
}

/** Another read holds the lane's lock, so this one only marked the snapshot unmeasurable and read nothing. */
export interface ReadUnderWayError {
  readonly code: "READ_UNDER_WAY";
  readonly message: string;
}

/** The read ran past the wall-clock deadline it keeps inside the supervisor's, so it stopped before the next call. */
export interface DeadlinePassedError {
  readonly code: "DEADLINE_PASSED";
  readonly message: string;
  readonly elapsedMs: number;
  readonly deadlineMs: number;
}

/** An announcement was edited between the channel read and its thread read, so the two describe different states. */
export interface RootMovedError {
  readonly code: "ROOT_MOVED";
  readonly message: string;
  readonly ref: string;
}

/** A newer update moved the incident's phase and incident.io has not yet edited the announcement to match. */
export interface RootBehindError {
  readonly code: "ROOT_BEHIND";
  readonly message: string;
  readonly ref: string;
}

/**
 * The store holding the snapshot and the sightings could not be opened or answered. Never a file fallback: the rows
 * are the authority, so with the store down what the lane holds is unknown — and nothing is known to be written.
 */
export interface OrgHealthStoreUnavailableError {
  readonly code: "STORE_UNAVAILABLE";
  readonly message: string;
  /** What the step was for, finishing "the store could not …" — carried so another union can restate it. */
  readonly doing: string;
  /** The store's own reason, never the connection string. */
  readonly reason: string;
}

/** A stored snapshot or sightings document does not decode — a row a newer checkout wrote, or one written past the port. */
export interface OrgHealthStoredInvalidError {
  readonly code: "STORED_INVALID";
  readonly message: string;
}

/** A newer read moved the snapshot's generation past this one's, so this read published nothing. Never retried. */
export interface OrgHealthRevisionConflictError {
  readonly code: "REVISION_CONFLICT";
  readonly message: string;
  readonly expectedRevision: number;
}

/** The runtime directory the read lock lives in could not be made or trusted, so the lock was not taken. */
export interface ReadLockUnavailableError {
  readonly code: "READ_LOCK_UNAVAILABLE";
  readonly message: string;
}

/** Every way the organisation-health lane fails. */
export type OrgHealthError =
  | AnnouncementMalformedError
  | BudgetExceededError
  | ConfigAbsentError
  | DeadlinePassedError
  | FileMalformedError
  | FileUnreadableError
  | OrgHealthRevisionConflictError
  | OrgHealthStoreUnavailableError
  | OrgHealthStoredInvalidError
  | ReadLockUnavailableError
  | ReadUnderWayError
  | RefMismatchError
  | RootBehindError
  | RootMovedError
  | SlackReadFailedError
  | UnknownStatusError;

/** The factories every organisation-health failure is built through, tests included. */
export const OrgHealthErrors = {
  announcementMalformed: ({ ts, detail }: { ts: string; detail: string }): AnnouncementMalformedError => ({
    code: "ANNOUNCEMENT_MALFORMED",
    message: `the incident.io message at ${ts} did not parse: ${detail}`,
    ts,
  }),
  budgetExceeded: ({ count, budget }: { count: number; budget: number }): BudgetExceededError => ({
    budget,
    code: "BUDGET_EXCEEDED",
    count,
    message:
      `${String(count)} incident threads need reading and a tick affords ${String(budget)} — refused before opening ` +
      "any; raise THREAD_BUDGET in `src/orgHealth/policy.ts` only with a fresh measurement",
  }),
  configAbsent: ({ path }: { path: string }): ConfigAbsentError => ({
    code: "CONFIG_ABSENT",
    message: `no incident channel is configured — set \`orgHealth.incidentChannelId\` in ${path}`,
    path,
  }),
  deadlinePassed: ({ elapsedMs, deadlineMs }: { elapsedMs: number; deadlineMs: number }): DeadlinePassedError => ({
    code: "DEADLINE_PASSED",
    deadlineMs,
    elapsedMs,
    message:
      `the read had taken ${String(elapsedMs)}ms of the ${String(deadlineMs)}ms it keeps inside a supervisor ` +
      "tick — it stopped reading Slack there",
  }),
  fileMalformed: ({ path, detail }: { path: string; detail: string }): FileMalformedError => ({
    code: "FILE_MALFORMED",
    message: `${path} does not decode: ${detail}`,
    path,
  }),
  fileUnreadable: ({ path, detail }: { path: string; detail: string }): FileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `${path} could not be read or written: ${detail}`,
    path,
  }),
  readLockUnavailable: ({ detail }: { detail: string }): ReadLockUnavailableError => ({
    code: "READ_LOCK_UNAVAILABLE",
    message: `the incident read lock could not be taken, so this read only marked the snapshot unmeasurable: ${detail}`,
  }),
  readUnderWay: ({ detail }: { detail: string }): ReadUnderWayError => ({
    code: "READ_UNDER_WAY",
    message: `another incident read holds the lock, so this one only marked the snapshot unmeasurable: ${detail}`,
  }),
  revisionConflict: ({ expectedRevision }: { expectedRevision: number }): OrgHealthRevisionConflictError => ({
    code: "REVISION_CONFLICT",
    expectedRevision,
    message:
      `a newer incident read moved the snapshot past generation ${String(expectedRevision)}, so this read ` +
      "published nothing — the newer read's outcome stands, and nothing retries this one",
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): OrgHealthStoreUnavailableError => ({
    code: "STORE_UNAVAILABLE",
    doing,
    message:
      `the incident snapshot and sightings live in the store, and the store could not ${doing}, so what they hold ` +
      "is UNKNOWN and nothing is known to be written — refusing rather than reading a file that stopped being the " +
      `authority (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
    reason,
  }),
  storedInvalid: ({ what, detail }: { what: string; detail: string }): OrgHealthStoredInvalidError => ({
    code: "STORED_INVALID",
    message: `the stored ${what} does not decode (${detail}) — the next complete \`slopweaver org-health read\` replaces it`,
  }),
  refMismatch: ({ ts, expected, found }: { ts: string; expected: string; found: string }): RefMismatchError => ({
    code: "REF_MISMATCH",
    message: `the update at ${ts} names ${found}, but it is threaded under ${expected}'s announcement`,
    ts,
  }),
  rootBehind: ({ ref, iso, detail }: { ref: string; iso: string; detail: string }): RootBehindError => ({
    code: "ROOT_BEHIND",
    message:
      `${ref}'s announcement disagrees with an update posted after its last edit, at ${iso} (${detail}) — incident.io has not edited ` +
      "it yet, so the next read sees one state",
    ref,
  }),
  rootMoved: ({ ref, detail }: { ref: string; detail: string }): RootMovedError => ({
    code: "ROOT_MOVED",
    message:
      `${ref}'s announcement no longer matches between the channel read and its thread read (${detail}) — the ` +
      "next read sees one state",
    ref,
  }),
  slackReadFailed: ({ channelId, detail }: { channelId: string; detail: string }): SlackReadFailedError => ({
    channelId,
    code: "SLACK_READ_FAILED",
    message: `the incident channel ${channelId} could not be read whole: ${detail}`,
  }),
  unknownStatus: ({ status, ref }: { status: string; ref: string }): UnknownStatusError => ({
    code: "UNKNOWN_STATUS",
    message:
      `${ref} carries the incident.io status "${status}", which no phase is mapped for — add it to ` +
      "`src/orgHealth/incidentIo.ts`'s STATUS_PHASES once its meaning is known",
    status,
  }),
} as const;
