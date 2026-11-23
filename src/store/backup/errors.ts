/**
 * The typed failures a backup and a restore author themselves: a stack command that would not run or exited
 * non-zero, a file that could not be read, digested or decoded, a manifest that is not one, a store selection
 * or an address that names nothing usable, a target that already holds a store, a restore whose bytes do not
 * match what the backup recorded, and a destination the operator never selected.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory. It stands beside the
 * narrower unions already here — `./localDestinationErrors.ts`, `./uploadErrors.ts`, `./sweepErrors.ts` and
 * `./secretsErrors.ts` — rather than absorbing them. A list of problems (a manifest's schema issues, every
 * digest that disagreed, a foreign step's own lines) rides as `reasons`, and {@link backupErrorLines} prints it
 * one line each, as the `readonly string[]` it replaced did.
 */

import { errorMessage } from "#lib/errorMessage.js";
import type {
  BackupArtefactDigestFailedError,
  BackupArtefactVanishedError,
  BackupCommandExitedError,
  BackupCommandLaunchFailedError,
  BackupDatabaseNameInvalidError,
  BackupDestinationKindNotBuiltError,
  BackupDestinationNotAbsoluteError,
  BackupDestinationOverlapsError,
  BackupDestinationUncreatableError,
  BackupDestinationUnselectedError,
  BackupFileNotJsonError,
  BackupFilesTargetNotEmptyError,
  BackupFileUnreadableError,
  BackupIntegrityFailedError,
  BackupKeyAbsentError,
  BackupManifestInvalidError,
  BackupRestoreSourceUnfinishedError,
  BackupRestoreTargetNotEmptyError,
  BackupSourceAddressInvalidError,
  BackupStagedManifestUnreadableError,
  BackupStepFailedError,
  BackupStoreDatabaseMissingError,
  BackupStoreUrlInvalidError,
  BackupTableCountFailedError,
  BackupTransportFailedError,
  BackupUploadFailedError,
} from "./errorVariants.js";
import type { BackupTransportError } from "./transport.js";

/** The remote destination kinds that are HELD: refused by name as not built, never read as a path. */
const HELD_DESTINATION_SCHEMES: ReadonlySet<string> = new Set(["s3", "gs", "drive"]);

/** Every failure this directory authors outside the transport, upload, sweep and secrets unions. */
export type BackupError =
  | BackupTableCountFailedError
  | BackupDestinationUnselectedError
  | BackupDestinationNotAbsoluteError
  | BackupDestinationKindNotBuiltError
  | BackupDestinationOverlapsError
  | BackupDestinationUncreatableError
  | BackupKeyAbsentError
  | BackupSourceAddressInvalidError
  | BackupManifestInvalidError
  | BackupStoreUrlInvalidError
  | BackupStoreDatabaseMissingError
  | BackupDatabaseNameInvalidError
  | BackupRestoreTargetNotEmptyError
  | BackupFilesTargetNotEmptyError
  | BackupRestoreSourceUnfinishedError
  | BackupFileNotJsonError
  | BackupIntegrityFailedError
  | BackupCommandLaunchFailedError
  | BackupCommandExitedError
  | BackupArtefactDigestFailedError
  | BackupArtefactVanishedError
  | BackupFileUnreadableError
  | BackupStagedManifestUnreadableError
  | BackupUploadFailedError
  | BackupTransportFailedError
  | BackupStepFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BackupErrors = {
  artefactDigestFailed: ({ path, cause }: { path: string; cause: unknown }): BackupArtefactDigestFailedError => ({
    cause,
    code: "ARTEFACT_DIGEST_FAILED",
    message: `could not digest ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  artefactVanished: ({ path, cause }: { path: string; cause: unknown }): BackupArtefactVanishedError => ({
    cause,
    code: "ARTEFACT_VANISHED",
    message: `${path} was removed before it could be digested: ${errorMessage({ error: cause })}`,
    path,
  }),
  backupKeyAbsent: ({ destination }: { destination: string }): BackupKeyAbsentError => ({
    code: "BACKUP_KEY_ABSENT",
    destination,
    message: `${destination} holds objects encrypted under the backup key, and the login Keychain holds no backup key to open them`,
  }),
  commandExited: ({
    label,
    status,
    stderr,
  }: {
    label: string;
    status: number | null;
    stderr: string;
  }): BackupCommandExitedError => ({
    code: "COMMAND_EXITED",
    label,
    message: `${label} exited ${String(status)}${stderr.length > 0 ? `: ${stderr}` : ""}`,
    status,
    stderr,
  }),
  commandLaunchFailed: ({ label, cause }: { label: string; cause: unknown }): BackupCommandLaunchFailedError => ({
    cause,
    code: "COMMAND_LAUNCH_FAILED",
    label,
    message: `${label}: ${errorMessage({ error: cause })}`,
  }),
  destinationKindNotBuilt: ({
    address,
    scheme,
  }: {
    address: string;
    scheme: string;
  }): BackupDestinationKindNotBuiltError => ({
    address,
    code: "DESTINATION_KIND_NOT_BUILT",
    message: HELD_DESTINATION_SCHEMES.has(scheme)
      ? `"${address}" names a ${scheme}:// destination, which is not built — a backup goes to a local folder or a mounted drive; name one as an absolute path or a file:// address`
      : `"${address}" is a ${scheme}: address, which is not a backup destination — name a local folder or a mounted drive as an absolute path or a file:// address`,
    scheme,
  }),
  destinationNotAbsolute: ({ destination }: { destination: string }): BackupDestinationNotAbsoluteError => ({
    code: "DESTINATION_NOT_ABSOLUTE",
    destination,
    message: `"${destination}" is not an absolute path — a backup destination never depends on the working directory`,
  }),
  destinationOverlaps: ({
    destination,
    path,
    role,
  }: {
    destination: string;
    path: string;
    role: string;
  }): BackupDestinationOverlapsError => ({
    code: "DESTINATION_OVERLAPS",
    destination,
    message: `the backup destination ${destination} and ${role} ${path} sit one inside the other — this run writes plaintext there, and the destination holds only encrypted objects; name a destination outside it`,
    path,
    role,
  }),
  destinationUncreatable: ({
    destination,
    cause,
  }: {
    destination: string;
    cause: unknown;
  }): BackupDestinationUncreatableError => ({
    cause,
    code: "DESTINATION_UNCREATABLE",
    destination,
    message: `could not create the backup destination ${destination}: ${errorMessage({ error: cause })}`,
  }),
  destinationUnselected: ({
    envName,
    secretName,
  }: {
    envName: string;
    secretName: string;
  }): BackupDestinationUnselectedError => ({
    code: "DESTINATION_UNSELECTED",
    envName,
    message:
      `no backup destination is selected — pass --destination <address>, set ${envName}, or remember one ` +
      `in secrets/${secretName} with \`slopweaver store backup --set-destination <address>\``,
    secretName,
  }),
  sourceAddressInvalid: ({ address, why }: { address: string; why: string }): BackupSourceAddressInvalidError => ({
    address,
    code: "SOURCE_ADDRESS_INVALID",
    message: `"${address}" is not a restore source: ${why}`,
    why,
  }),
  databaseNameInvalid: ({ name }: { name: string }): BackupDatabaseNameInvalidError => ({
    code: "DATABASE_NAME_INVALID",
    message: `"${name}" is not a database name this verb will create — lower-case letters, digits and _ only`,
    name,
  }),
  fileNotJson: ({ file, directory }: { file: string; directory: string }): BackupFileNotJsonError => ({
    code: "BACKUP_FILE_NOT_JSON",
    directory,
    file,
    message: `${file} in ${directory} is not JSON`,
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: unknown }): BackupFileUnreadableError => ({
    cause,
    code: "BACKUP_FILE_UNREADABLE",
    message: `could not read ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  filesMismatched: ({
    differences,
    restored,
    manifest,
  }: {
    differences: readonly string[];
    restored: number;
    manifest: string;
  }): BackupIntegrityFailedError => {
    const reasons = [
      `${String(differences.length)} of ${String(restored)} restored file(s) do not match ${manifest}`,
      ...differences,
    ];
    return { code: "BACKUP_INTEGRITY_FAILED", message: reasons.join("; "), reasons };
  },
  integrityFailed: ({ reasons }: { reasons: readonly string[] }): BackupIntegrityFailedError => ({
    code: "BACKUP_INTEGRITY_FAILED",
    message: reasons.join("; "),
    reasons,
  }),
  manifestInvalid: ({
    manifest,
    reasons,
  }: {
    manifest: "backup" | "files";
    reasons: readonly string[];
  }): BackupManifestInvalidError => ({ code: "MANIFEST_INVALID", manifest, message: reasons.join("; "), reasons }),
  restoreSourceUnfinished: ({
    directory,
    manifest,
  }: {
    directory: string;
    manifest: string;
  }): BackupRestoreSourceUnfinishedError => ({
    code: "RESTORE_SOURCE_UNFINISHED",
    directory,
    manifest,
    message: `${directory} holds no ${manifest} — not a finished backup directory`,
  }),
  filesTargetNotEmpty: ({ into }: { into: string }): BackupFilesTargetNotEmptyError => ({
    code: "FILES_TARGET_NOT_EMPTY",
    into,
    message:
      `${into} already holds files — a files restore rebuilds into an empty or absent directory only, so ` +
      "nothing already there can alias or be mistaken for what it restored; name a fresh one",
  }),
  restoreTargetNotEmpty: ({ publicTables }: { publicTables: number }): BackupRestoreTargetNotEmptyError => ({
    code: "RESTORE_TARGET_NOT_EMPTY",
    message:
      `the target already holds ${String(publicTables)} table(s) in public — a restore never writes over a store; ` +
      "name an empty or a fresh-stack database",
    publicTables,
  }),
  stagedManifestUnreadable: ({
    path,
    cause,
  }: {
    path: string;
    cause: unknown;
  }): BackupStagedManifestUnreadableError => ({
    cause,
    code: "STAGED_MANIFEST_UNREADABLE",
    message: errorMessage({ error: cause }),
    path,
  }),
  stepFailed: ({ reasons }: { reasons: readonly string[] }): BackupStepFailedError => ({
    code: "BACKUP_STEP_FAILED",
    message: reasons.join("; "),
    reasons,
  }),
  storeDatabaseMissing: (): BackupStoreDatabaseMissingError => ({
    code: "STORE_DATABASE_MISSING",
    message: "the store selection names no database in its path",
  }),
  storeUrlUnreadable: (): BackupStoreUrlInvalidError => ({
    code: "STORE_URL_INVALID",
    message: "the store selection is not a URL a database name can be read from",
    operation: "read-database",
  }),
  storeUrlUnrewritable: (): BackupStoreUrlInvalidError => ({
    code: "STORE_URL_INVALID",
    message: "the store selection is not a URL a database name can be replaced in",
    operation: "replace-database",
  }),
  transportFailed: ({ transportError }: { transportError: BackupTransportError }): BackupTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message: transportError.message,
    transportError,
  }),
  tableCountFailed: ({ cause }: { cause: unknown }): BackupTableCountFailedError => ({
    cause,
    code: "TABLE_COUNT_FAILED",
    message: `could not count tables: ${errorMessage({ error: cause })}`,
  }),
  uploadFailed: ({ objectName, cause }: { objectName: string; cause: unknown }): BackupUploadFailedError => ({
    cause,
    code: "UPLOAD_FAILED",
    message: errorMessage({ error: cause }),
    objectName,
  }),
} as const;

/**
 * The lines a {@link BackupError} prints, one per problem. A list-carrying variant gives each entry its own line,
 * as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function backupErrorLines({ error }: { error: BackupError }): readonly string[] {
  if (
    error.code === "MANIFEST_INVALID" ||
    error.code === "BACKUP_INTEGRITY_FAILED" ||
    error.code === "BACKUP_STEP_FAILED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
