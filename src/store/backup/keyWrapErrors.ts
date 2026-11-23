/**
 * The backup key wrap's own typed error union (`./keyWrap.ts`, `./keyWrapStore.ts`). No variant carries the
 * password, the key or any byte of either: a fingerprint, an object name and what was observed are enough.
 */
import { CREATE_MASTER_PASSWORD_COMMAND } from "./masterPasswordErrors.js";

/** The password offered for a NEW wrap is shorter than the floor. */
export interface KeyWrapPasswordTooShortError {
  readonly code: "KEY_WRAP_PASSWORD_TOO_SHORT";
  readonly message: string;
}

/** What was handed in as the key is not a 32-byte key. */
export interface KeyWrapKeyInvalidError {
  readonly code: "KEY_WRAP_KEY_INVALID";
  readonly message: string;
}

/** Every check that needs no key passed and the wrap still did not authenticate: overwhelmingly a wrong password. */
export interface KeyWrapWrongPasswordError {
  readonly code: "KEY_WRAP_WRONG_PASSWORD";
  readonly message: string;
  readonly objectName: string;
}

/** The wrap does not open with the magic this build writes. */
export interface KeyWrapUnknownFormatError {
  readonly code: "KEY_WRAP_UNKNOWN_FORMAT";
  readonly message: string;
  readonly objectName: string;
}

/** The wrap's header or length is damaged, or it opened to something that is not a 32-byte key. */
export interface KeyWrapCorruptError {
  readonly code: "KEY_WRAP_CORRUPT";
  readonly message: string;
  readonly objectName: string;
}

/** The wrap opened, and the key inside is not the key the backup was written under. */
export interface KeyWrapFingerprintMismatchError {
  readonly code: "KEY_WRAP_FINGERPRINT_MISMATCH";
  readonly message: string;
  readonly objectName: string;
  readonly expectedFingerprint: string;
  readonly foundFingerprint: string;
}

/** The destination holds no wrap for the key a backup was written under. */
export interface KeyWrapAbsentError {
  readonly code: "KEY_WRAP_ABSENT";
  readonly message: string;
  readonly objectName: string;
  readonly fingerprint: string;
}

/** Reading or writing the destination, or the scratch file beside it, failed. */
export interface KeyWrapTransportFailedError {
  readonly code: "KEY_WRAP_TRANSPORT_FAILED";
  readonly message: string;
  readonly objectName: string;
}

/** Every way wrapping, storing or opening the backup key fails. */
export type KeyWrapError =
  | KeyWrapAbsentError
  | KeyWrapCorruptError
  | KeyWrapFingerprintMismatchError
  | KeyWrapKeyInvalidError
  | KeyWrapPasswordTooShortError
  | KeyWrapTransportFailedError
  | KeyWrapUnknownFormatError
  | KeyWrapWrongPasswordError;

/** The factory every producer of a {@link KeyWrapError} calls. */
export const KeyWrapErrors = {
  absent: ({ objectName, fingerprint }: { objectName: string; fingerprint: string }): KeyWrapAbsentError => ({
    code: "KEY_WRAP_ABSENT",
    fingerprint,
    message:
      `the destination holds no wrapped copy of backup key ${fingerprint} (${objectName}), so the master password ` +
      `cannot open this backup. On the Mac that holds the key, \`${CREATE_MASTER_PASSWORD_COMMAND}\` or the next ` +
      "`slopweaver store backup` writes it",
    objectName,
  }),
  corrupt: ({ objectName, detail }: { objectName: string; detail: string }): KeyWrapCorruptError => ({
    code: "KEY_WRAP_CORRUPT",
    message: `the wrapped backup key ${objectName} is damaged: ${detail}`,
    objectName,
  }),
  fingerprintMismatch: ({
    objectName,
    expectedFingerprint,
    foundFingerprint,
  }: {
    objectName: string;
    expectedFingerprint: string;
    foundFingerprint: string;
  }): KeyWrapFingerprintMismatchError => ({
    code: "KEY_WRAP_FINGERPRINT_MISMATCH",
    expectedFingerprint,
    foundFingerprint,
    message: `the wrap ${objectName} opened to key ${foundFingerprint}, and the backup was written under ${expectedFingerprint}`,
    objectName,
  }),
  keyInvalid: ({ bytes }: { bytes: number }): KeyWrapKeyInvalidError => ({
    code: "KEY_WRAP_KEY_INVALID",
    message: `a backup key is 32 bytes, and ${String(bytes)} were handed in to be wrapped`,
  }),
  passwordTooShort: ({ detail }: { detail: string }): KeyWrapPasswordTooShortError => ({
    code: "KEY_WRAP_PASSWORD_TOO_SHORT",
    message: `the backup key was not wrapped: ${detail}`,
  }),
  transportFailed: ({ objectName, detail }: { objectName: string; detail: string }): KeyWrapTransportFailedError => ({
    code: "KEY_WRAP_TRANSPORT_FAILED",
    message: `moving the wrapped backup key ${objectName} failed: ${detail}`,
    objectName,
  }),
  unknownFormat: ({ objectName }: { objectName: string }): KeyWrapUnknownFormatError => ({
    code: "KEY_WRAP_UNKNOWN_FORMAT",
    message: `${objectName} is not a wrapped backup key this build reads`,
    objectName,
  }),
  wrongPassword: ({ objectName }: { objectName: string }): KeyWrapWrongPasswordError => ({
    code: "KEY_WRAP_WRONG_PASSWORD",
    message:
      `that master password does not open ${objectName}. It is the one line in your password manager. The header ` +
      "parsed and the lengths matched, so this is a wrong password in every case but one: a wrap damaged beneath an " +
      "intact header looks the same, and AES-GCM cannot tell the two apart",
    objectName,
  }),
} as const;
