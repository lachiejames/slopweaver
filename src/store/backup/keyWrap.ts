/**
 * The backup key, wrapped by the master password — pure, no I/O. The key every object is encrypted under is 32
 * random bytes in this Mac's Keychain (`./backupKeychain.ts`); this is the copy of it a lost Mac can open, sealed
 * in the passphrase envelope (`./passphraseEnvelope.ts`) under its own magic and written to the destination at
 * {@link backupKeyWrapObjectName}. Wrapping the key rather than re-deriving it is why nothing already written is
 * re-encrypted: every earlier backup under the same key opens through the same wrap.
 *
 * ## Why the object is named for the key's fingerprint
 *
 * A second Mac that made its own key and writes to the same destination gets its own wrap beside the first, never
 * over it. A recovery reads the fingerprint off the backup's own manifest header (`objectFingerprintOf`) and opens
 * exactly that key's wrap, then checks the key inside names the same fingerprint.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type KeyWrapError, KeyWrapErrors } from "./keyWrapErrors.js";
import { validateMasterPassword } from "./masterPassword.js";
import { BACKUP_KEY_BYTES, keyFingerprint } from "./objectCrypto.js";
import { openPassphraseEnvelope, sealPassphraseEnvelope } from "./passphraseEnvelope.js";
import type { PassphraseEnvelopeError } from "./passphraseEnvelopeErrors.js";

/** The first line of every wrap: the magic, and the FORMAT version a reader must recognise. */
export const BACKUP_KEY_WRAP_MAGIC = "SLOPWEAVER-BACKUP-KEY-1";

/** The directory segment under `<project>/` every wrap lives in — never an instant, so no listing reads it as one. */
const KEY_WRAP_SEGMENT = "keys";

/**
 * Where one key's wrap lives at the destination.
 *
 * @param project the project segment every prefix of this install begins with
 * @param fingerprint the key's fingerprint
 * @returns `<project>/keys/<fingerprint>.wrap`
 */
export function backupKeyWrapObjectName({ project, fingerprint }: { project: string; fingerprint: string }): string {
  return `${project}/${KEY_WRAP_SEGMENT}/${fingerprint}.wrap`;
}

/**
 * Wrap the backup key under the master password.
 *
 * @param key the 32-byte backup key
 * @param password the master password; one shorter than the floor is refused
 * @returns the wrap's bytes, or why it was not made
 */
export function wrapBackupKey({ key, password }: { key: Buffer; password: string }): Result<Buffer, KeyWrapError> {
  if (key.length !== BACKUP_KEY_BYTES) {
    return err(KeyWrapErrors.keyInvalid({ bytes: key.length }));
  }
  const valid = validateMasterPassword({ password });
  if (valid.isErr()) {
    return err(KeyWrapErrors.passwordTooShort({ detail: valid.error.message }));
  }
  return sealPassphraseEnvelope({ magic: BACKUP_KEY_WRAP_MAGIC, passphrase: password, plaintext: key }).mapErr(
    (error) => KeyWrapErrors.corrupt({ detail: error.message, objectName: "(new wrap)" }),
  );
}

/**
 * Name an envelope failure as the wrap's own error.
 *
 * @param error what the envelope reported
 * @param objectName the wrap, for the message
 * @returns the same failure in the wrap's terms
 */
function asWrapError({ error, objectName }: { error: PassphraseEnvelopeError; objectName: string }): KeyWrapError {
  switch (error.code) {
    case "ENVELOPE_AUTHENTICATION_FAILED":
      return KeyWrapErrors.wrongPassword({ objectName });
    case "ENVELOPE_UNKNOWN_FORMAT":
      return KeyWrapErrors.unknownFormat({ objectName });
    case "ENVELOPE_CORRUPT":
    case "ENVELOPE_EMPTY_PASSPHRASE":
      return KeyWrapErrors.corrupt({ detail: error.message, objectName });
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

/**
 * Open a wrap with the master password and check the key inside is the one expected.
 *
 * @param armoured the wrap's bytes as read from the destination
 * @param expectedFingerprint the fingerprint the backup's objects name
 * @param password the master password, as pasted or read
 * @param objectName the wrap, for the message
 * @returns the 32-byte key, or why it could not be opened
 */
export function unwrapBackupKey({
  armoured,
  expectedFingerprint,
  password,
  objectName,
}: {
  armoured: Buffer;
  expectedFingerprint: string;
  password: string;
  objectName: string;
}): Result<Buffer, KeyWrapError> {
  const opened = openPassphraseEnvelope({ armoured, magic: BACKUP_KEY_WRAP_MAGIC, passphrase: password });
  if (opened.isErr()) {
    return err(asWrapError({ error: opened.error, objectName }));
  }
  const key = opened.value;
  if (key.length !== BACKUP_KEY_BYTES) {
    return err(KeyWrapErrors.corrupt({ detail: `it opened to ${String(key.length)} bytes, not a key`, objectName }));
  }
  const found = keyFingerprint({ key });
  if (found !== expectedFingerprint) {
    return err(KeyWrapErrors.fingerprintMismatch({ expectedFingerprint, foundFingerprint: found, objectName }));
  }
  return ok(key);
}
