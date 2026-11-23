/**
 * The secrets leg's own typed error union — the failures of reading, encrypting, decrypting and putting
 * back `$SLOPWEAVER_HOME/secrets/` as one passphrase-encrypted artefact.
 *
 * Per `.claude/rules/error-handling.md`: one `<Domain>Error` union and one `<Domain>Errors` factory scoped
 * to this bounded module, sharing no base type with `localDestinationErrors.ts` or `uploadErrors.ts` next door. The
 * union is mandatory rather than a judgement call here — five distinct kinds, and a caller genuinely
 * branches on at least two of them.
 *
 * **The branch that matters is `WRONG_PASSPHRASE` versus `BUNDLE_CORRUPT`.** AES-GCM reports both as the
 * same authentication-tag mismatch, so the two are separated by what could be checked BEFORE the tag was:
 * a bundle whose magic line and header parse, whose declared lengths match the bytes present, and which
 * then fails to authenticate, is overwhelmingly a wrong passphrase — and {@link SecretsBackupErrors.wrongPassphrase}
 * says out loud that a damaged ciphertext body with an intact header is the one case it cannot tell apart.
 * Claiming certainty the cipher does not provide would send a person hunting for a corrupt download when
 * they had simply pasted the wrong line out of their password manager.
 *
 * No variant carries a passphrase, a plaintext, or any part of either. A `cause` is carried only where it
 * came from the filesystem, never from `node:crypto`, because a cipher's own error text is the one place a
 * key-dependent detail could leak into a log.
 */

/** No `backup-passphrase` secret is set on this machine, so there is nothing to encrypt the bundle with. */
export interface NoPassphraseSetError {
  readonly code: "NO_PASSPHRASE_SET";
  readonly message: string;
  /** The absolute path the passphrase would have been read from, so a reader can check it themselves. */
  readonly path: string;
}

/** Nothing was typed at the prompt, or piped in, so there was no passphrase to try. */
export interface NoPassphraseEnteredError {
  readonly code: "NO_PASSPHRASE_ENTERED";
  readonly message: string;
}

/** The bundle authenticated against neither the passphrase given nor, possibly, its own bytes. */
export interface WrongPassphraseError {
  readonly code: "WRONG_PASSPHRASE";
  readonly message: string;
}

/** The bundle's declared shape and its actual bytes disagree — truncated, or damaged in transit. */
export interface BundleCorruptError {
  readonly code: "BUNDLE_CORRUPT";
  readonly message: string;
}

/** The file is not a bundle this build knows how to read — a missing magic line, or a later format version. */
export interface UnknownFormatError {
  readonly code: "UNKNOWN_FORMAT";
  readonly message: string;
  /** What stood where the magic line should be, truncated for a log. */
  readonly found: string;
}

/** The backup being restored carried no credentials bundle at all, and its manifest says so. */
export interface SecretsNotInBackupError {
  readonly code: "SECRETS_NOT_IN_BACKUP";
  readonly message: string;
  /** The instant the backup was taken, so a reader can go and look for a later one. */
  readonly createdAtIso: string;
}

/** The secrets directory, or one file under it, could not be read or written. */
export interface SecretsUnreadableError {
  readonly code: "SECRETS_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every way the secrets leg fails. */
export type SecretsBackupError =
  | NoPassphraseEnteredError
  | NoPassphraseSetError
  | SecretsNotInBackupError
  | WrongPassphraseError
  | BundleCorruptError
  | UnknownFormatError
  | SecretsUnreadableError;

/** How many characters of an unrecognised header line a refusal quotes back. */
const FOUND_PREVIEW_CHARS = 40;

/**
 * Render the "what stood there instead" preview safely.
 *
 * The magic line is printable ASCII by construction, so every byte outside that range is noise — and a
 * file that is not a bundle at all could be anything, including something nobody wants echoed into a
 * terminal or a log. Replacing them costs a reader nothing (`SLOPWEAVER-SECRETS-1` survives verbatim) and
 * removes the question. Raised by this branch's own r1 review.
 *
 * @param found the raw bytes that stood where the magic line should be
 * @returns at most {@link FOUND_PREVIEW_CHARS} characters, every non-printable one replaced
 */
function preview({ found }: { found: string }): string {
  return found.slice(0, FOUND_PREVIEW_CHARS).replaceAll(/[^\x20-\x7e]/gu, "·");
}

/** The factory every producer of a {@link SecretsBackupError} calls, so a message is written once. */
export const SecretsBackupErrors = {
  bundleCorrupt: ({ detail }: { detail: string }): BundleCorruptError => ({
    code: "BUNDLE_CORRUPT",
    message: `the secrets bundle is truncated or damaged: ${detail} — fetch it from the destination again`,
  }),
  noPassphraseEntered: (): NoPassphraseEnteredError => ({
    code: "NO_PASSPHRASE_ENTERED",
    message:
      "no passphrase was entered, so nothing was decrypted. It is the one line you keep in your password manager;" +
      "paste it at the prompt, or pipe it in when stdin is not a terminal",
  }),
  noPassphraseSet: ({ path }: { path: string }): NoPassphraseSetError => ({
    code: "NO_PASSPHRASE_SET",
    message:
      "no backup-passphrase is set, so the credentials are NOT in this backup. " +
      "Set it once, pasting from your password manager:slopweaver secrets set backup-passphrase",
    path,
  }),
  secretsNotInBackup: ({ createdAtIso }: { createdAtIso: string }): SecretsNotInBackupError => ({
    code: "SECRETS_NOT_IN_BACKUP",
    createdAtIso,
    message:
      `the backup taken at ${createdAtIso} carries no credentials — its manifest records \`secrets: null\`, ` +
      "which means no backup-passphrase was set on the machine that took it. A later backup may carry them; " +
      "this one is complete without them and nothing is corrupt",
  }),
  secretsUnreadable: ({ path, cause }: { path: string; cause: unknown }): SecretsUnreadableError => ({
    cause,
    code: "SECRETS_UNREADABLE",
    message: `could not read or write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  unknownFormat: ({ found }: { found: string }): UnknownFormatError => ({
    code: "UNKNOWN_FORMAT",
    found: preview({ found }),
    message:
      `the secrets bundle does not open with a magic line this build reads (found ${JSON.stringify(preview({ found }))}) — ` +
      "it is either not a bundle, or one written by a later version of slopweaver",
  }),
  wrongPassphrase: (): WrongPassphraseError => ({
    code: "WRONG_PASSPHRASE",
    message:
      "that passphrase does not open this bundle — it is the one you set with `slopweaver secrets set backup-passphrase`, from your password manager." +
      "The header parsed and the lengths matched, so this is a wrong passphrase rather than a damaged file in every case except one: " +
      "a ciphertext body corrupted beneath an intact header is indistinguishable from it, and AES-GCM cannot tell you which happened.",
  }),
} as const;
