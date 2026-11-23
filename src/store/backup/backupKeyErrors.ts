/**
 * The backup key's own typed error union (`./backupKeychain.ts`). No variant ever carries a byte of the key:
 * a message names the Keychain service and what was observed, nothing else.
 */

/** No backup key is in the Keychain. */
export interface BackupKeyAbsentError {
  readonly code: "BACKUP_KEY_ABSENT";
  readonly message: string;
  readonly service: string;
}

/** The Keychain holding the key is locked, so it cannot be read without a prompt — and none is ever raised. */
export interface BackupKeyLockedError {
  readonly code: "BACKUP_KEY_LOCKED";
  readonly message: string;
  readonly service: string;
}

/** The item is there but is not 32 bytes of base64 — never used, never replaced. */
export interface BackupKeyMalformedError {
  readonly code: "BACKUP_KEY_MALFORMED";
  readonly message: string;
  readonly service: string;
}

/** `security` failed some other way. */
export interface BackupKeyReadFailedError {
  readonly code: "BACKUP_KEY_READ_FAILED";
  readonly message: string;
  readonly service: string;
  readonly status: number;
}

/** A key already exists, and creating one never replaces it. */
export interface BackupKeyExistsError {
  readonly code: "BACKUP_KEY_EXISTS";
  readonly message: string;
  readonly service: string;
}

/** Writing the new key failed. */
export interface BackupKeyWriteFailedError {
  readonly code: "BACKUP_KEY_WRITE_FAILED";
  readonly message: string;
  readonly service: string;
  readonly status: number;
}

/** The key read back after the write is not the key that was written. */
export interface BackupKeyReadbackMismatchError {
  readonly code: "BACKUP_KEY_READBACK_MISMATCH";
  readonly message: string;
  readonly service: string;
}

/** Every way reading or creating the backup key fails. */
export type BackupKeyError =
  | BackupKeyAbsentError
  | BackupKeyExistsError
  | BackupKeyLockedError
  | BackupKeyMalformedError
  | BackupKeyReadbackMismatchError
  | BackupKeyReadFailedError
  | BackupKeyWriteFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BackupKeyErrors = {
  absent: ({ service }: { service: string }): BackupKeyAbsentError => ({
    code: "BACKUP_KEY_ABSENT",
    message: `no backup key in the Keychain (service ${service}) — create one with \`slopweaver store backup --create-key\``,
    service,
  }),
  exists: ({ service }: { service: string }): BackupKeyExistsError => ({
    code: "BACKUP_KEY_EXISTS",
    message: `a backup key already exists in the Keychain (service ${service}); it is never replaced, because every backup it wrote needs it`,
    service,
  }),
  locked: ({ service }: { service: string }): BackupKeyLockedError => ({
    code: "BACKUP_KEY_LOCKED",
    message: `the Keychain holding the backup key (service ${service}) is locked; the backup never prompts, so it did not run`,
    service,
  }),
  malformed: ({ service }: { service: string }): BackupKeyMalformedError => ({
    code: "BACKUP_KEY_MALFORMED",
    message: `the Keychain item ${service} is not a 32-byte base64 backup key; it was left untouched`,
    service,
  }),
  readFailed: ({ service, status }: { service: string; status: number }): BackupKeyReadFailedError => ({
    code: "BACKUP_KEY_READ_FAILED",
    message: `reading the backup key (service ${service}) failed: security exited ${String(status)}`,
    service,
    status,
  }),
  readbackMismatch: ({ service }: { service: string }): BackupKeyReadbackMismatchError => ({
    code: "BACKUP_KEY_READBACK_MISMATCH",
    message: `the backup key read back from the Keychain (service ${service}) is not the key just written`,
    service,
  }),
  writeFailed: ({ service, status }: { service: string; status: number }): BackupKeyWriteFailedError => ({
    code: "BACKUP_KEY_WRITE_FAILED",
    message: `writing the backup key (service ${service}) failed: security exited ${String(status)}`,
    service,
    status,
  }),
} as const;
