/**
 * The master password's own typed error union (`./masterPassword.ts`). No variant ever carries the password or
 * any part of it: a path, a length and what was observed are all a refusal needs.
 */

/** A password shorter than the generated length — the wrap is only as strong as what guards it offline. */
export interface MasterPasswordTooShortError {
  readonly code: "MASTER_PASSWORD_TOO_SHORT";
  readonly message: string;
  readonly length: number;
}

/** No master password is set on this machine, and the caller cannot go on without one. */
export interface MasterPasswordAbsentError {
  readonly code: "MASTER_PASSWORD_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The master password file exists and could not be read. */
export interface MasterPasswordUnreadableError {
  readonly code: "MASTER_PASSWORD_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Nothing was typed at the prompt or piped in. */
export interface MasterPasswordNotEnteredError {
  readonly code: "MASTER_PASSWORD_NOT_ENTERED";
  readonly message: string;
}

/** Handing the password to the clipboard failed. */
export interface MasterPasswordClipboardFailedError {
  readonly code: "MASTER_PASSWORD_CLIPBOARD_FAILED";
  readonly message: string;
  readonly status: number;
}

/** Every way reading, checking or handing over the master password fails. */
export type MasterPasswordError =
  | MasterPasswordAbsentError
  | MasterPasswordClipboardFailedError
  | MasterPasswordNotEnteredError
  | MasterPasswordTooShortError
  | MasterPasswordUnreadableError;

/** The verb that makes the master password, named once for every message that points at it. */
export const CREATE_MASTER_PASSWORD_COMMAND = "slopweaver store backup --create-master-password";

/** The factory every producer of a {@link MasterPasswordError} calls. */
export const MasterPasswordErrors = {
  absent: ({ path }: { path: string }): MasterPasswordAbsentError => ({
    code: "MASTER_PASSWORD_ABSENT",
    message: `no backup master password is set (${path}) — make one with \`${CREATE_MASTER_PASSWORD_COMMAND}\``,
    path,
  }),
  clipboardFailed: ({ status }: { status: number }): MasterPasswordClipboardFailedError => ({
    code: "MASTER_PASSWORD_CLIPBOARD_FAILED",
    message: `copying the master password to the clipboard failed: pbcopy exited ${String(status)}`,
    status,
  }),
  notEntered: (): MasterPasswordNotEnteredError => ({
    code: "MASTER_PASSWORD_NOT_ENTERED",
    message:
      "no master password was entered, so nothing was opened. It is the one line you keep in your password manager; " +
      "paste it at the prompt, or pipe it in when stdin is not a terminal",
  }),
  tooShort: ({ length, minimum }: { length: number; minimum: number }): MasterPasswordTooShortError => ({
    code: "MASTER_PASSWORD_TOO_SHORT",
    length,
    message:
      `the backup master password is ${String(length)} characters, and it must be at least ${String(minimum)} — ` +
      `a typed one is refused; \`${CREATE_MASTER_PASSWORD_COMMAND}\` generates one`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): MasterPasswordUnreadableError => ({
    code: "MASTER_PASSWORD_UNREADABLE",
    message: `the backup master password at ${path} exists and could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
