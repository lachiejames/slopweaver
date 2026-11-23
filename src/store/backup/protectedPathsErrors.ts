/**
 * The typed errors of a backup's protected-path policy (`./protectedPaths.ts`). Every message names the protected
 * path and the owner's reason, because a refusal that says neither leaves the reader nothing to act on.
 */
import type { ProtectedPath } from "../../protectedPaths/registry.js";

/** A registry that applies to this run could not be read, so the owner's protection is unknown and nothing runs. */
export interface BackupProtectionUnreadableError {
  readonly code: "BACKUP_PROTECTION_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** A registry that applies to this run was read and is not a registry. */
export interface BackupProtectionMalformedError {
  readonly code: "BACKUP_PROTECTION_MALFORMED";
  readonly message: string;
  readonly file: string;
}

/** A place this run must write to, or read whole, is a protected path. */
export interface BackupProtectedPlaceError {
  readonly code: "BACKUP_PROTECTED_PLACE";
  readonly message: string;
  /** The place the run would have touched. */
  readonly target: string;
  /** What that place is to the run: `the backup staging root`, `destination`. */
  readonly role: string;
  /** The registry entry that refused it. */
  readonly entry: ProtectedPath;
}

/** Why a backup's protected-path policy refused to let a run, or one destination of it, go ahead. */
export type BackupProtectionError =
  BackupProtectionUnreadableError | BackupProtectionMalformedError | BackupProtectedPlaceError;

/** Builders for {@link BackupProtectionError}. */
export const BackupProtectionErrors = {
  malformed: ({ file, why }: { file: string; why: string }): BackupProtectionMalformedError => ({
    code: "BACKUP_PROTECTION_MALFORMED",
    file,
    message:
      `the protected-path registry ${file} is malformed (${why}), so which paths the owner protects is unknown and ` +
      "the backup is HELD — fix it with `slopweaver protect`",
  }),
  protectedPlace: ({
    target,
    role,
    entry,
  }: {
    target: string;
    role: string;
    entry: ProtectedPath;
  }): BackupProtectedPlaceError => ({
    code: "BACKUP_PROTECTED_PLACE",
    entry,
    message:
      `HELD: ${role} ${target} reaches ${entry.path}, which the owner marked ${entry.mode} (${entry.why}); ` +
      "a backup never writes into a protected path, nor reads a no-access one — choose another place",
    role,
    target,
  }),
  unreadable: ({ file, why }: { file: string; why: string }): BackupProtectionUnreadableError => ({
    code: "BACKUP_PROTECTION_UNREADABLE",
    file,
    message:
      `the protected-path registry ${file} could not be read (${why}), so which paths the owner protects is unknown ` +
      "and the backup is HELD",
  }),
} as const;
