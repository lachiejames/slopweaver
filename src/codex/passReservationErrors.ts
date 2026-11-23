/**
 * Everything the Codex pass reservation store can fail on, as one union scoped to that one mechanism
 * (`./passReservationStore.ts`).
 *
 * Five variants, because each is handled differently: a lock that would not come, and a document that would not
 * read, parse or publish, each hold every usage-limited account out of the pass while an unlimited one may still take
 * it; a fleet read that failed leaves the pass nowhere to go at all. Every one carries `message`, which is what the
 * routed pass prints, and none of them claims provider usage.
 */
import { errorMessage } from "#lib/errorMessage.js";

/**
 * The reservation lock did not come within its wait.
 *
 * @internal a member of the exported {@link CodexPassReservationError}, matched by `code` rather than imported.
 */
export interface CodexPassReservationLockUnavailableError {
  readonly code: "PASS_RESERVATION_LOCK_UNAVAILABLE";
  readonly message: string;
}

/**
 * The document exists and could not be read.
 *
 * @internal a member of the exported {@link CodexPassReservationError}, matched by `code` rather than imported.
 */
export interface CodexPassReservationStoreUnreadableError {
  readonly code: "PASS_RESERVATION_STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * The document was read and is not a reservation document.
 *
 * @internal a member of the exported {@link CodexPassReservationError}, matched by `code` rather than imported.
 */
export interface CodexPassReservationStoreMalformedError {
  readonly code: "PASS_RESERVATION_STORE_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/**
 * The new document could not be published.
 *
 * @internal a member of the exported {@link CodexPassReservationError}, matched by `code` rather than imported.
 */
export interface CodexPassReservationStoreWriteFailedError {
  readonly code: "PASS_RESERVATION_STORE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/**
 * The fleet could not be read, so there is nothing to route or reserve against.
 *
 * @internal a member of the exported {@link CodexPassReservationError}, matched by `code` rather than imported.
 */
export interface CodexPassReservationFleetReadFailedError {
  readonly code: "PASS_RESERVATION_FLEET_READ_FAILED";
  readonly message: string;
}

/** Everything the pass reservation store can fail on. */
export type CodexPassReservationError =
  | CodexPassReservationLockUnavailableError
  | CodexPassReservationStoreUnreadableError
  | CodexPassReservationStoreMalformedError
  | CodexPassReservationStoreWriteFailedError
  | CodexPassReservationFleetReadFailedError;

/** The factory every reservation failure is built through, so a test builds them exactly as the store does. */
export const CodexPassReservationErrors = {
  fleetReadFailed: ({ reason }: { reason: string }): CodexPassReservationFleetReadFailedError => ({
    code: "PASS_RESERVATION_FLEET_READ_FAILED",
    message: `the Codex fleet could not be read (${reason}), and an unreadable fleet is not evidence of a cap`,
  }),
  lockUnavailable: ({ reason }: { reason: string }): CodexPassReservationLockUnavailableError => ({
    code: "PASS_RESERVATION_LOCK_UNAVAILABLE",
    message: `the pass reservation lock did not come: ${reason}`,
  }),
  storeMalformed: ({
    path,
    problems,
  }: {
    path: string;
    problems: readonly string[];
  }): CodexPassReservationStoreMalformedError => ({
    code: "PASS_RESERVATION_STORE_MALFORMED",
    message: `the pass reservation document ${path} is not a reservation document: ${problems.join("; ")}`,
    path,
  }),
  storeUnreadable: ({ cause, path }: { cause: unknown; path: string }): CodexPassReservationStoreUnreadableError => ({
    code: "PASS_RESERVATION_STORE_UNREADABLE",
    message: `the pass reservation document ${path} could not be read: ${errorMessage({ error: cause })}`,
    path,
  }),
  storeWriteFailed: ({ cause, path }: { cause: unknown; path: string }): CodexPassReservationStoreWriteFailedError => ({
    code: "PASS_RESERVATION_STORE_WRITE_FAILED",
    message: `the pass reservation document ${path} could not be written: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;
