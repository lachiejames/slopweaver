/**
 * Every reason `automation repoint` leaves the store as it stood, apart from the plan's own refusals
 * (`../../../live/automation/standingRowRepositoryRepoint.ts`'s `RepointError`, carried whole). A caller branches on
 * `code` and displays `message`; each variant's message says what was and was not written.
 */
import type { RepointError } from "../../../live/automation/standingRowRepositoryRepoint.js";

/** The canonical file is a link or another non-file, so an atomic replace would change what it points at. */
interface RepointNotRegularFileError {
  readonly code: "NOT_REGULAR_FILE";
  readonly message: string;
  readonly path: string;
}

/** A store read the plan needs did not complete. */
interface RepointStoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
}

/** The checkout this install declares does not resolve to a repository, so there is nothing to repoint to. */
interface RepointOwnRepositoryUnresolvedError {
  readonly code: "OWN_REPOSITORY_UNRESOLVED";
  readonly message: string;
}

/** The plan refused the row. */
interface RepointPlanRefusedError {
  readonly code: "PLAN_REFUSED";
  readonly message: string;
  readonly refusal: RepointError;
}

/** The lock was taken from this run before a write. */
interface RepointLockLostError {
  readonly code: "LOCK_LOST";
  readonly message: string;
  readonly historyRecorded: boolean;
}

/** A write under the lock failed. */
interface RepointWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly historyRecorded: boolean;
}

/** Every reason a repoint run wrote no row. */
export type RepointRunError =
  | RepointNotRegularFileError
  | RepointStoreUnreadableError
  | RepointOwnRepositoryUnresolvedError
  | RepointPlanRefusedError
  | RepointLockLostError
  | RepointWriteFailedError;

/** Why a write stops when the lock was taken from this run between the plan and the write. */
const LOCK_LOST = "the definition hold lock was taken over before the write, so another pass holds the store";

/** The one factory for every {@link RepointRunError}. */
export const RepointRunErrors = {
  declarationUnreadable: ({ cause }: { cause: string }): RepointStoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `${cause} — nothing changed`,
  }),
  definitionsUnlisted: ({ cause }: { cause: string }): RepointStoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `the definition store did not list (${cause}) — nothing changed`,
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: string }): RepointStoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `${path} did not read: ${cause} — nothing changed`,
  }),
  historyUnwritten: ({ cause }: { cause: string }): RepointWriteFailedError => ({
    code: "WRITE_FAILED",
    historyRecorded: false,
    message: `${cause} — nothing changed`,
  }),
  lockLostBeforeHistory: (): RepointLockLostError => ({
    code: "LOCK_LOST",
    historyRecorded: false,
    message: `${LOCK_LOST} — nothing changed; run this again`,
  }),
  lockLostBeforeRow: ({ repository }: { repository: string }): RepointLockLostError => ({
    code: "LOCK_LOST",
    historyRecorded: true,
    message: `${LOCK_LOST} — ${repository} is recorded, the row is unchanged; run this again`,
  }),
  notRegularFile: ({ path }: { path: string }): RepointNotRegularFileError => ({
    code: "NOT_REGULAR_FILE",
    message: `${path} is not a regular file, so replacing it would change what it points at — nothing changed`,
    path,
  }),
  ownRepositoryUnresolved: ({ line }: { line: string }): RepointOwnRepositoryUnresolvedError => ({
    code: "OWN_REPOSITORY_UNRESOLVED",
    message: line,
  }),
  planRefused: ({ refusal }: { refusal: RepointError }): RepointPlanRefusedError => ({
    code: "PLAN_REFUSED",
    message: refusal.message,
    refusal,
  }),
  rowUnwritten: ({
    repository,
    file,
    cause,
  }: {
    repository: string;
    file: string;
    cause: string;
  }): RepointWriteFailedError => ({
    code: "WRITE_FAILED",
    historyRecorded: true,
    message:
      `${repository} is recorded as an address a pass meant to write, but ${file} did not write (${cause}) — ` +
      "the row is unchanged; run this again",
  }),
} as const;
