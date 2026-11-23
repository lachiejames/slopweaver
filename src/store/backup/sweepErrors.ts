/**
 * The sweep's own typed error union — every way an EARLIER staging the destination never got cannot be put
 * there now. Distinct from `uploadErrors.ts`, whose subject is a file that landed and is not what the
 * manifest describes, and from `localDestinationErrors.ts`, whose subject is the write failing. They share
 * no base type, per `.claude/rules/error-handling.md`.
 *
 * A union rather than two more strings on the plain list because this is the directory's threshold: `src/
 * store/backup` sits at the `error-shape-threshold` floor, and the gate's ruling is that a domain past it
 * declares its union instead of growing the list.
 *
 * {@link StagingSweepErrors.unreadableManifest} carries the most, and deliberately. A staging whose
 * manifest this schema refuses is not RESTORABLE either — `slopweaver store restore --from <dir>` reads it
 * through the same `parseBackupManifest` — so a message saying only "skipped" would leave a reader with no
 * reason to know the directory is dead weight rather than a pending upload.
 */
import { BACKUP_FILES, FILES_MANIFEST } from "./plan.js";

/** A stranded staging's `manifest.json` is not a manifest this code can read. */
export interface StagingUnreadableError {
  readonly code: "STAGING_MANIFEST_UNREADABLE";
  readonly message: string;
  readonly directory: string;
  /** What the manifest schema said, field by field. */
  readonly problems: readonly string[];
}

/** A stranded staging's bytes could not be sent. */
export interface StagingUploadFailedError {
  readonly code: "STAGING_UPLOAD_FAILED";
  readonly message: string;
  readonly directory: string;
  /** What the upload leg reported, forwarded rather than restated. */
  readonly problems: readonly string[];
}

/** Recovering a stranded staging THREW rather than returning — the sweep swallows it into a report line. */
export interface StagingRecoveryThrewError {
  readonly code: "STAGING_RECOVERY_THREW";
  readonly message: string;
  readonly directory: string;
}

/** A stranded staging's manifest names a prefix other than this install's own for the directory it sits in. */
export interface StagingMisnamedError {
  readonly code: "STAGING_MISNAMED";
  readonly message: string;
  readonly directory: string;
  readonly prefix: string;
}

/** A stranded staging's objects were sent, but what its `files.json` names could not be checked against the destination. */
export interface StagingFilesUncheckedError {
  readonly code: "STAGING_FILES_UNCHECKED";
  readonly message: string;
  readonly directory: string;
  /** Why the check could not run, forwarded rather than restated. */
  readonly problems: readonly string[];
}

/** Every way an earlier staging stays out of the destination. */
export type StagingSweepError =
  | StagingMisnamedError
  | StagingUnreadableError
  | StagingUploadFailedError
  | StagingRecoveryThrewError
  | StagingFilesUncheckedError;

/** The factories the sweep constructs its failures with. Tests build fixtures through these. */
export const StagingSweepErrors = {
  misnamed: ({ directory, prefix }: { directory: string; prefix: string }): StagingMisnamedError => ({
    code: "STAGING_MISNAMED",
    directory,
    message:
      `${BACKUP_FILES.manifest} in ${directory} names the prefix ${prefix}, not this install's own for the ` +
      `directory it sits in — sending it would give this directory a receipt for another prefix, so it is not sent.`,
    prefix,
  }),
  unreadableManifest: ({
    directory,
    problems,
  }: {
    directory: string;
    problems: readonly string[];
  }): StagingUnreadableError => ({
    code: "STAGING_MANIFEST_UNREADABLE",
    directory,
    message:
      `${problems.join("; ")} — ${BACKUP_FILES.manifest} in ${directory} cannot be read as a backup manifest, ` +
      `so \`slopweaver store restore --from ${directory}\` would refuse it for the same reason. This staging ` +
      `is not recoverable and not restorable.`,
    problems,
  }),
  uploadFailed: ({
    directory,
    problems,
  }: {
    directory: string;
    problems: readonly string[];
  }): StagingUploadFailedError => ({
    code: "STAGING_UPLOAD_FAILED",
    directory,
    message: `${problems.join("; ")} — ${directory} is still on this machine only.`,
    problems,
  }),
  filesUnchecked: ({
    directory,
    problems,
  }: {
    directory: string;
    problems: readonly string[];
  }): StagingFilesUncheckedError => ({
    code: "STAGING_FILES_UNCHECKED",
    directory,
    message:
      `${problems.join("; ")} — ${directory}'s objects were sent, but which of the files its ` +
      `${FILES_MANIFEST} names the destination holds could not be checked, so it has no receipt and the next ` +
      `\`store backup --sweep-only\` tries again.`,
    problems,
  }),
  recoveryThrew: ({ cause, directory }: { cause: unknown; directory: string }): StagingRecoveryThrewError => ({
    code: "STAGING_RECOVERY_THREW",
    directory,
    message:
      `${cause instanceof Error ? cause.message : String(cause)} — recovering ${directory} threw instead of ` +
      `returning, so it is still on this machine only. Tonight's own backup is unaffected.`,
  }),
} as const;
