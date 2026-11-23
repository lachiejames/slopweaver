/**
 * The variants of `BackupError`, one interface each. They live apart from the union, its factory and its
 * printer in `./errors.ts` only so neither file outgrows what a reader holds at once; nothing imports one of
 * these by name except that union and its factory.
 */

import type { BackupTransportError } from "./transport.js";

/** Counting the tables of a database threw. */
export interface BackupTableCountFailedError {
  readonly code: "TABLE_COUNT_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** No local backup destination was named by flag, environment or the remembered secret. */
export interface BackupDestinationUnselectedError {
  readonly code: "DESTINATION_UNSELECTED";
  readonly message: string;
  readonly envName: string;
  readonly secretName: string;
}

/** A backup destination was named, but not as an absolute path, so where it lands would depend on the cwd. */
export interface BackupDestinationNotAbsoluteError {
  readonly code: "DESTINATION_NOT_ABSOLUTE";
  readonly message: string;
  readonly destination: string;
}

/**
 * A destination address names a kind this build does not write — a remote store (`s3://`, `gs://`, `drive://`)
 * is held until one is wanted, and any other scheme is not a destination at all. Never read as a path.
 */
export interface BackupDestinationKindNotBuiltError {
  readonly code: "DESTINATION_KIND_NOT_BUILT";
  readonly message: string;
  readonly address: string;
  readonly scheme: string;
}

/** The destination and a place a run writes plaintext to sit one inside the other. */
export interface BackupDestinationOverlapsError {
  readonly code: "DESTINATION_OVERLAPS";
  readonly message: string;
  readonly destination: string;
  /** The place the run writes, as named. */
  readonly path: string;
  /** What that place is — the home, or the flag that named it. */
  readonly role: string;
}

/** A writing run could not make the destination directory it was named. */
export interface BackupDestinationUncreatableError {
  readonly code: "DESTINATION_UNCREATABLE";
  readonly message: string;
  readonly destination: string;
  readonly cause: unknown;
}

/** A destination holds encrypted objects and the login Keychain holds no backup key to open them. */
export interface BackupKeyAbsentError {
  readonly code: "BACKUP_KEY_ABSENT";
  readonly message: string;
  readonly destination: string;
}

/** A restore's `--from` is neither a backup directory nor a `<root>/<project>/<instant>` destination address. */
export interface BackupSourceAddressInvalidError {
  readonly code: "SOURCE_ADDRESS_INVALID";
  readonly message: string;
  readonly address: string;
  readonly why: string;
}

/** A backup's `manifest.json` or its `files.json` is not the schema this build writes; `reasons` is every issue. */
export interface BackupManifestInvalidError {
  readonly code: "MANIFEST_INVALID";
  readonly message: string;
  readonly manifest: "backup" | "files";
  readonly reasons: readonly string[];
}

/** The store selection is not a URL whose database name can be read or replaced. */
export interface BackupStoreUrlInvalidError {
  readonly code: "STORE_URL_INVALID";
  readonly message: string;
  readonly operation: "read-database" | "replace-database";
}

/** The store selection is a URL whose path names no database. */
export interface BackupStoreDatabaseMissingError {
  readonly code: "STORE_DATABASE_MISSING";
  readonly message: string;
}

/** A database name this verb will not create. */
export interface BackupDatabaseNameInvalidError {
  readonly code: "DATABASE_NAME_INVALID";
  readonly message: string;
  readonly name: string;
}

/** The restore target's `public` schema already holds tables, so it is a store and is never written over. */
export interface BackupRestoreTargetNotEmptyError {
  readonly code: "RESTORE_TARGET_NOT_EMPTY";
  readonly message: string;
  readonly publicTables: number;
}

/** The `--files-into` directory already holds something, so a files restore will not write into it. */
export interface BackupFilesTargetNotEmptyError {
  readonly code: "FILES_TARGET_NOT_EMPTY";
  readonly message: string;
  readonly into: string;
}

/** A local `--from` directory holds no manifest, so it is not a finished backup. */
export interface BackupRestoreSourceUnfinishedError {
  readonly code: "RESTORE_SOURCE_UNFINISHED";
  readonly message: string;
  readonly directory: string;
  readonly manifest: string;
}

/** A backup file was read and is not JSON. */
export interface BackupFileNotJsonError {
  readonly code: "BACKUP_FILE_NOT_JSON";
  readonly message: string;
  readonly file: string;
  readonly directory: string;
}

/** A restore's bytes disagree with what the backup recorded; `reasons` is every disagreement, one per line. */
export interface BackupIntegrityFailedError {
  readonly code: "BACKUP_INTEGRITY_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A stack command could not be launched at all. */
export interface BackupCommandLaunchFailedError {
  readonly code: "COMMAND_LAUNCH_FAILED";
  readonly message: string;
  readonly label: string;
  readonly cause: unknown;
}

/** A stack command ran and exited non-zero; `stderr` is what it said, trimmed. */
export interface BackupCommandExitedError {
  readonly code: "COMMAND_EXITED";
  readonly message: string;
  readonly label: string;
  readonly status: number | null;
  readonly stderr: string;
}

/** A staged file could not be measured and digested. */
export interface BackupArtefactDigestFailedError {
  readonly code: "ARTEFACT_DIGEST_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * A file was gone by the time it was digested — removed after it was listed. Distinct from
 * {@link BackupArtefactDigestFailedError} so the backed-up-root walk can omit it while every other caller fails.
 */
export interface BackupArtefactVanishedError {
  readonly code: "ARTEFACT_VANISHED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A small backup file could not be read. */
export interface BackupFileUnreadableError {
  readonly code: "BACKUP_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A staged manifest could not be read or decoded; the message is the reader's own words. */
export interface BackupStagedManifestUnreadableError {
  readonly code: "STAGED_MANIFEST_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** An upload failed on its last retry; the message is that attempt's own words. */
export interface BackupUploadFailedError {
  readonly code: "UPLOAD_FAILED";
  readonly message: string;
  readonly objectName: string;
  readonly cause: unknown;
}

/** A destination operation failed; the destination's own typed failure rides as `transportError`. */
export interface BackupTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly transportError: BackupTransportError;
}

/** A step outside this union failed with its own list of lines, carried as `reasons`. */
export interface BackupStepFailedError {
  readonly code: "BACKUP_STEP_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}
