/**
 * The backup object cipher's own typed error union (`./objectCrypto.ts`). Every variant names the object it is
 * about. Kept apart from the destination's unions because a failure here is about the BYTES — not encrypted,
 * cut short, under another key, tampered with — never about reaching the place they are kept.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** The object does not open with the encrypted-object magic — plaintext, or another format entirely. */
export interface ObjectNotEncryptedError {
  readonly code: "OBJECT_NOT_ENCRYPTED";
  readonly message: string;
  readonly objectName: string;
}

/** The object is shorter than the fixed header and tag, so it cannot be a whole encrypted object. */
export interface ObjectTruncatedError {
  readonly code: "OBJECT_TRUNCATED";
  readonly message: string;
  readonly objectName: string;
  readonly bytes: number;
}

/** The object was written under a different key than the one in hand. */
export interface ObjectKeyMismatchError {
  readonly code: "OBJECT_KEY_MISMATCH";
  readonly message: string;
  readonly objectName: string;
  readonly expectedFingerprint: string;
  readonly foundFingerprint: string;
}

/** The tag did not verify: the header, ciphertext or tag was changed after it was written. */
export interface ObjectAuthenticationFailedError {
  readonly code: "OBJECT_AUTHENTICATION_FAILED";
  readonly message: string;
  readonly objectName: string;
}

/** Reading the plaintext or writing the ciphertext failed on disk. */
export interface ObjectEncryptFailedError {
  readonly code: "OBJECT_ENCRYPT_FAILED";
  readonly message: string;
  readonly objectName: string;
  readonly cause?: unknown;
}

/** Reading the ciphertext or writing the plaintext failed on disk, before any verdict on the tag. */
export interface ObjectDecryptFailedError {
  readonly code: "OBJECT_DECRYPT_FAILED";
  readonly message: string;
  readonly objectName: string;
  readonly cause?: unknown;
}

/** A decrypt aimed at a path inside the destination, where its plaintext would replace a stored object. */
export interface ObjectTargetInsideDestinationError {
  readonly code: "OBJECT_TARGET_INSIDE_DESTINATION";
  readonly message: string;
  readonly objectName: string;
  readonly path: string;
}

/** A decrypt target whose links cannot all be resolved — one points at nothing, or cannot be read. */
export interface ObjectTargetUnresolvableError {
  readonly code: "OBJECT_TARGET_UNRESOLVABLE";
  readonly message: string;
  readonly objectName: string;
  readonly path: string;
}

/** The destination reports a stored ciphertext whose length or digest is not what was sealed. */
export interface ObjectLandedWrongError {
  readonly code: "OBJECT_LANDED_WRONG";
  readonly message: string;
  readonly objectName: string;
  readonly sealedBytes: number;
  readonly landedBytes: number;
}

/** Every way the object cipher fails. */
export type ObjectCryptoError =
  | ObjectAuthenticationFailedError
  | ObjectDecryptFailedError
  | ObjectEncryptFailedError
  | ObjectKeyMismatchError
  | ObjectLandedWrongError
  | ObjectNotEncryptedError
  | ObjectTargetInsideDestinationError
  | ObjectTargetUnresolvableError
  | ObjectTruncatedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ObjectCryptoErrors = {
  authenticationFailed: ({ objectName }: { objectName: string }): ObjectAuthenticationFailedError => ({
    code: "OBJECT_AUTHENTICATION_FAILED",
    message: `${objectName} failed authentication — it was changed after it was written, and nothing was restored from it`,
    objectName,
  }),
  decryptFailed: ({ objectName, cause }: { objectName: string; cause: unknown }): ObjectDecryptFailedError => ({
    cause,
    code: "OBJECT_DECRYPT_FAILED",
    message: `could not decrypt ${objectName}: ${errorMessage({ error: cause })}`,
    objectName,
  }),
  encryptFailed: ({ objectName, cause }: { objectName: string; cause: unknown }): ObjectEncryptFailedError => ({
    cause,
    code: "OBJECT_ENCRYPT_FAILED",
    message: `could not encrypt ${objectName}: ${errorMessage({ error: cause })}`,
    objectName,
  }),
  keyMismatch: ({
    objectName,
    expectedFingerprint,
    foundFingerprint,
  }: {
    objectName: string;
    expectedFingerprint: string;
    foundFingerprint: string;
  }): ObjectKeyMismatchError => ({
    code: "OBJECT_KEY_MISMATCH",
    expectedFingerprint,
    foundFingerprint,
    message: `${objectName} was written under backup key ${foundFingerprint}, not the key in hand (${expectedFingerprint})`,
    objectName,
  }),
  landedWrong: ({
    objectName,
    sealedBytes,
    landedBytes,
  }: {
    objectName: string;
    sealedBytes: number;
    landedBytes: number;
  }): ObjectLandedWrongError => ({
    code: "OBJECT_LANDED_WRONG",
    landedBytes,
    message: `${objectName} was sealed as ${String(sealedBytes)} byte(s) of ciphertext and the destination stored ${String(landedBytes)} byte(s), or other bytes of that length — it is not the object that was sent`,
    objectName,
    sealedBytes,
  }),
  notEncrypted: ({ objectName }: { objectName: string }): ObjectNotEncryptedError => ({
    code: "OBJECT_NOT_ENCRYPTED",
    message: `${objectName} is not an encrypted backup object; an encrypted destination never reads plaintext`,
    objectName,
  }),
  targetInside: ({ objectName, path }: { objectName: string; path: string }): ObjectTargetInsideDestinationError => ({
    code: "OBJECT_TARGET_INSIDE_DESTINATION",
    message: `refused to decrypt ${objectName} to ${path}: that path is inside the encrypted destination, so its plaintext would replace a stored object`,
    objectName,
    path,
  }),
  targetUnresolvable: ({
    objectName,
    path,
    why,
  }: {
    objectName: string;
    path: string;
    why: string;
  }): ObjectTargetUnresolvableError => ({
    code: "OBJECT_TARGET_UNRESOLVABLE",
    message: `refused to decrypt ${objectName} to ${path}: ${why}; a link that cannot be resolved now could be re-pointed into the destination during the fetch`,
    objectName,
    path,
  }),
  truncated: ({ objectName, bytes }: { objectName: string; bytes: number }): ObjectTruncatedError => ({
    bytes,
    code: "OBJECT_TRUNCATED",
    message: `${objectName} is ${String(bytes)} byte(s), shorter than an encrypted object's fixed header and tag`,
    objectName,
  }),
} as const;
