/**
 * The passphrase envelope's own typed error union (`./passphraseEnvelope.ts`). Each caller — the credentials
 * bundle, the backup key's wrap — maps these into its own domain union, so no domain shares this one.
 *
 * No variant carries a passphrase, a derived key, a plaintext or a `node:crypto` message: a cipher's own error
 * text is the one place a key-dependent detail could leak into a log.
 */

/** The bytes do not open with the magic line the caller expects. */
export interface EnvelopeUnknownFormatError {
  readonly code: "ENVELOPE_UNKNOWN_FORMAT";
  readonly message: string;
  /** What stood where the magic line should be, made printable and truncated for a log. */
  readonly found: string;
}

/** The header or the ciphertext is malformed, truncated, or asks for parameters this build does not use. */
export interface EnvelopeCorruptError {
  readonly code: "ENVELOPE_CORRUPT";
  readonly message: string;
  readonly detail: string;
}

/** Sealing was asked for with an empty passphrase, which would encrypt nothing worth the name. */
export interface EnvelopeEmptyPassphraseError {
  readonly code: "ENVELOPE_EMPTY_PASSPHRASE";
  readonly message: string;
}

/** Every check that needs no key passed and the GCM tag still did not verify: overwhelmingly a wrong passphrase. */
export interface EnvelopeAuthenticationFailedError {
  readonly code: "ENVELOPE_AUTHENTICATION_FAILED";
  readonly message: string;
}

/** Every way sealing or opening a passphrase envelope fails. */
export type PassphraseEnvelopeError =
  EnvelopeAuthenticationFailedError | EnvelopeCorruptError | EnvelopeEmptyPassphraseError | EnvelopeUnknownFormatError;

/** How many characters of an unrecognised magic line a refusal quotes back. */
const FOUND_PREVIEW_CHARS = 40;

/**
 * The "what stood there instead" preview, every non-printable byte replaced so nothing odd reaches a terminal.
 *
 * @param found the raw text that stood where the magic line should be
 * @returns at most {@link FOUND_PREVIEW_CHARS} printable characters
 */
function preview({ found }: { found: string }): string {
  return found.slice(0, FOUND_PREVIEW_CHARS).replaceAll(/[^\x20-\x7e]/gu, "·");
}

/** The factory every producer of a {@link PassphraseEnvelopeError} calls. */
export const PassphraseEnvelopeErrors = {
  authenticationFailed: (): EnvelopeAuthenticationFailedError => ({
    code: "ENVELOPE_AUTHENTICATION_FAILED",
    message: "the envelope did not authenticate under this passphrase",
  }),
  corrupt: ({ detail }: { detail: string }): EnvelopeCorruptError => ({
    code: "ENVELOPE_CORRUPT",
    detail,
    message: `the envelope is truncated or damaged: ${detail}`,
  }),
  emptyPassphrase: (): EnvelopeEmptyPassphraseError => ({
    code: "ENVELOPE_EMPTY_PASSPHRASE",
    message: "an empty passphrase cannot encrypt anything",
  }),
  unknownFormat: ({ found }: { found: string }): EnvelopeUnknownFormatError => ({
    code: "ENVELOPE_UNKNOWN_FORMAT",
    found: preview({ found }),
    message: `not an envelope this build reads (found "${preview({ found })}")`,
  }),
} as const;
