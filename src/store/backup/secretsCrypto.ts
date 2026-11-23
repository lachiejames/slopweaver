/**
 * The cipher for the backup's credentials leg — the passphrase envelope (`./passphraseEnvelope.ts`) under the
 * `SLOPWEAVER-SECRETS-1` magic, with its failures named in the credentials leg's own terms.
 *
 * ## Why a passphrase at all, and why only one
 *
 * The owner wants exactly one password, set in their own password manager and copy-pasted into a
 * restore command. That one password is the backup's master password: it seals this bundle and wraps the backup
 * key (`./keyWrap.ts`). Slopweaver never reads it from the password manager: the backup reads its own `0600`
 * secret file, and a restore takes it pasted into a no-echo prompt or piped stdin.
 *
 * ## Why symmetric, when the nightly is unattended
 *
 * A passphrase-derived KEYPAIR (public half cached so an unattended run can encrypt without a secret) was
 * considered and rejected. It defends one thing a symmetric key does not: an attacker who can read the
 * machine. But that attacker has already won — every secret this bundle holds is sitting beside the
 * passphrase in `$SLOPWEAVER_HOME/secrets/` at `0600`, in plaintext, which is the whole reason the bundle
 * exists. The threat a backup passphrase actually answers is a DESTINATION compromise: somebody who reaches
 * the backed-up objects without reaching this disk. Against that, a symmetric key held only on this disk is
 * complete, and the keypair buys a second primitive and a cached public key for nothing.
 *
 * Salt and IV are fresh per call, so two backups of identical secrets produce different bytes, which costs a few
 * KB re-uploaded nightly and nothing notices.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  openPassphraseEnvelope,
  type PassphraseEnvelope,
  parsePassphraseEnvelope,
  sealPassphraseEnvelope,
} from "./passphraseEnvelope.js";
import type { PassphraseEnvelopeError } from "./passphraseEnvelopeErrors.js";
import { type SecretsBackupError, SecretsBackupErrors } from "./secretsErrors.js";

/** The first line of every bundle: the magic, and the FORMAT version a reader must recognise. */
export const SECRETS_BUNDLE_MAGIC = "SLOPWEAVER-SECRETS-1";

/**
 * Name an envelope failure as the credentials leg's own error.
 *
 * @param error what the envelope reported
 * @returns the same failure in this leg's terms
 */
function asSecretsError({ error }: { error: PassphraseEnvelopeError }): SecretsBackupError {
  switch (error.code) {
    case "ENVELOPE_AUTHENTICATION_FAILED":
      return SecretsBackupErrors.wrongPassphrase();
    case "ENVELOPE_CORRUPT":
      return SecretsBackupErrors.bundleCorrupt({ detail: error.detail });
    case "ENVELOPE_EMPTY_PASSPHRASE":
      return SecretsBackupErrors.bundleCorrupt({ detail: error.message });
    case "ENVELOPE_UNKNOWN_FORMAT":
      return SecretsBackupErrors.unknownFormat({ found: error.found });
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

/**
 * Encrypt a plaintext bundle under a passphrase, producing the whole file's bytes.
 *
 * @param plaintext the serialised bundle
 * @param passphrase the master password; an empty one is refused rather than silently weak
 * @returns the complete bundle file, or why it could not be written
 */
export function encryptSecretsBundle({
  plaintext,
  passphrase,
}: {
  plaintext: Buffer;
  passphrase: string;
}): Result<Buffer, SecretsBackupError> {
  return sealPassphraseEnvelope({ magic: SECRETS_BUNDLE_MAGIC, passphrase, plaintext }).mapErr((error) =>
    asSecretsError({ error }),
  );
}

/**
 * Split a bundle file into its magic line, its header and its ciphertext, checking every parameter and declared
 * length before any key is derived.
 *
 * @param armoured the whole file as read from disk
 * @returns the envelope with its ciphertext, or why it is not one
 */
export function parseSecretsEnvelope({
  armoured,
}: {
  armoured: Buffer;
}): Result<PassphraseEnvelope, SecretsBackupError> {
  const parsed = parsePassphraseEnvelope({ armoured, magic: SECRETS_BUNDLE_MAGIC });
  if (parsed.isErr()) {
    return err(asSecretsError({ error: parsed.error }));
  }
  return ok(parsed.value);
}

/**
 * Open a bundle with a passphrase, returning the plaintext it was built from. A bundle sealed under any passphrase
 * length opens here: the master password's minimum is enforced where a NEW one is read, never on history.
 *
 * @param armoured the whole bundle file
 * @param passphrase the single line pasted from the operator's password manager
 * @returns the plaintext, or which of the four ways this failed
 */
export function decryptSecretsBundle({
  armoured,
  passphrase,
}: {
  armoured: Buffer;
  passphrase: string;
}): Result<Buffer, SecretsBackupError> {
  return openPassphraseEnvelope({ armoured, magic: SECRETS_BUNDLE_MAGIC, passphrase }).mapErr((error) =>
    asSecretsError({ error }),
  );
}
