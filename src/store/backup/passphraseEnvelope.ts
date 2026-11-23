/**
 * The passphrase envelope — scrypt then AES-256-GCM, pure, `node:crypto` only, no I/O. Two artefacts are sealed
 * this way, each under its own magic line: the credentials bundle (`./secretsCrypto.ts`) and the backup key's
 * wrap (`./keyWrap.ts`), both under the one master password the operator keeps in a password manager.
 *
 * ## The envelope
 *
 * ```text
 * <MAGIC>\n                magic + FORMAT version, so an unknown shape is refused rather than misread
 * {json header}\n          kdf + its parameters, salt, iv, tag — everything but the key
 * <ciphertext bytes>       the rest of the file, raw
 * ```
 *
 * Salt and IV are fresh per call, so sealing the same plaintext twice produces different bytes — a deterministic
 * ciphertext would tell a destination reader which nights the content changed.
 *
 * ## Why the parameters are checked EXACTLY
 *
 * `scrypt` at N=2^17 is deliberately slow: it is paid once by a person who has just lost a machine, and what it
 * slows is an offline guess against a copy of the destination. The header is not authenticated data, and it is
 * read from the destination, so a header asking for an N of 2^30 would make the reader allocate before any tag is
 * checked. This build writes exactly one parameter set and opens exactly that one; anything else is
 * `ENVELOPE_CORRUPT` before scrypt runs. Node's default `maxmem` refuses an N this large, so {@link SCRYPT_MAXMEM}
 * raises it explicitly — 128·N·r plus headroom.
 *
 * ## Telling a wrong passphrase from a damaged file
 *
 * AES-GCM reports both as one tag mismatch, so everything checkable without the key — the magic line, the
 * header's JSON, every parameter and declared length — is checked first. A failure past that point is
 * `ENVELOPE_AUTHENTICATION_FAILED`, and each caller's message says the one case it cannot separate: a damaged
 * ciphertext body beneath an intact header.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { parseJsonObject } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { type PassphraseEnvelopeError, PassphraseEnvelopeErrors } from "./passphraseEnvelopeErrors.js";

/** scrypt cost. Paid once per restore by a human; the attacker paying it is guessing offline. */
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** `128 * N * r` is scrypt's own working set; the doubling is the headroom node wants on top of it. */
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

/** The header line's parsed shape — everything needed to derive the key again, and never the key. */
export interface PassphraseEnvelope {
  readonly kdf: "scrypt";
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly keyBytes: number;
  readonly saltB64: string;
  readonly ivB64: string;
  readonly tagB64: string;
  readonly cipher: "aes-256-gcm";
  /** The ciphertext, already separated from the two header lines. */
  readonly ciphertext: Buffer;
}

/**
 * Derive the content key from a passphrase and a salt, at the one parameter set this build uses.
 *
 * @param passphrase the single line from the operator's password manager
 * @param salt this envelope's own salt
 * @returns the 32-byte key
 */
function deriveKey({ passphrase, salt }: { passphrase: string; salt: Buffer }): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES, { N: SCRYPT_N, maxmem: SCRYPT_MAXMEM, p: SCRYPT_P, r: SCRYPT_R });
}

/**
 * Seal a plaintext under a passphrase, producing the whole envelope's bytes.
 *
 * @param plaintext what is sealed
 * @param passphrase the operator's one line; an empty one is refused rather than silently weak
 * @param magic the first line, naming the artefact and its format version
 * @returns the complete envelope, or why it could not be sealed
 */
export function sealPassphraseEnvelope({
  plaintext,
  passphrase,
  magic,
}: {
  plaintext: Buffer;
  passphrase: string;
  magic: string;
}): Result<Buffer, PassphraseEnvelopeError> {
  if (passphrase.length === 0) {
    return err(PassphraseEnvelopeErrors.emptyPassphrase());
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey({ passphrase, salt });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = JSON.stringify({
    cipher: "aes-256-gcm",
    ivB64: iv.toString("base64"),
    kdf: "scrypt",
    keyBytes: KEY_BYTES,
    n: SCRYPT_N,
    p: SCRYPT_P,
    r: SCRYPT_R,
    saltB64: salt.toString("base64"),
    tagB64: cipher.getAuthTag().toString("base64"),
  });
  return ok(Buffer.concat([Buffer.from(`${magic}\n${header}\n`, "utf8"), ciphertext]));
}

/**
 * Split an envelope into its magic line, header and ciphertext, and check every parameter and declared length
 * against what this build writes and the bytes actually present.
 *
 * @param armoured the whole envelope as read
 * @param magic the first line the caller expects
 * @returns the envelope with its ciphertext, or why it is not one
 */
export function parsePassphraseEnvelope({
  armoured,
  magic,
}: {
  armoured: Buffer;
  magic: string;
}): Result<PassphraseEnvelope, PassphraseEnvelopeError> {
  const firstBreak = armoured.indexOf(0x0a);
  if (firstBreak < 0) {
    return err(PassphraseEnvelopeErrors.unknownFormat({ found: armoured.subarray(0, 64).toString("utf8") }));
  }
  const found = armoured.subarray(0, firstBreak).toString("utf8");
  if (found !== magic) {
    return err(PassphraseEnvelopeErrors.unknownFormat({ found }));
  }
  const secondBreak = armoured.indexOf(0x0a, firstBreak + 1);
  if (secondBreak < 0) {
    return err(PassphraseEnvelopeErrors.corrupt({ detail: "the header line never ends" }));
  }
  const decoded = parseJsonObject({ text: armoured.subarray(firstBreak + 1, secondBreak).toString("utf8") });
  if (decoded.isErr()) {
    return err(PassphraseEnvelopeErrors.corrupt({ detail: "the header line is not a JSON object" }));
  }
  const fields = headerFields({ header: decoded.value });
  if (fields.isErr()) {
    return err(fields.error);
  }
  const ciphertext = armoured.subarray(secondBreak + 1);
  if (ciphertext.length === 0) {
    return err(PassphraseEnvelopeErrors.corrupt({ detail: "the header is followed by no ciphertext at all" }));
  }
  return ok({ ...fields.value, ciphertext });
}

/** The parameters this build writes, each checked for equality on the way back in. */
const EXACT_PARAMETERS = [
  { expected: SCRYPT_N, field: "n" },
  { expected: SCRYPT_R, field: "r" },
  { expected: SCRYPT_P, field: "p" },
  { expected: KEY_BYTES, field: "keyBytes" },
] as const;

/**
 * Validate the decoded header field by field, so a shape that merely parsed as JSON cannot reach scrypt.
 *
 * @param header the decoded header object
 * @returns every field the cipher needs, or why the header is not usable
 */
function headerFields({
  header,
}: {
  header: Record<string, unknown>;
}): Result<Omit<PassphraseEnvelope, "ciphertext">, PassphraseEnvelopeError> {
  if (header["kdf"] !== "scrypt" || header["cipher"] !== "aes-256-gcm") {
    return err(
      PassphraseEnvelopeErrors.unknownFormat({
        found: `kdf=${String(header["kdf"])} cipher=${String(header["cipher"])}`,
      }),
    );
  }
  for (const { field, expected } of EXACT_PARAMETERS) {
    const value = header[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      return err(PassphraseEnvelopeErrors.corrupt({ detail: `${field} is not a positive integer` }));
    }
    if (value !== expected) {
      return err(
        PassphraseEnvelopeErrors.corrupt({
          detail: `the header asks for ${field}=${String(value)}, and this build opens only ${field}=${String(expected)}`,
        }),
      );
    }
  }
  const salt = decodeExact({ field: "saltB64", length: SALT_BYTES, value: header["saltB64"] });
  if (salt.isErr()) {
    return err(salt.error);
  }
  const iv = decodeExact({ field: "ivB64", length: IV_BYTES, value: header["ivB64"] });
  if (iv.isErr()) {
    return err(iv.error);
  }
  const tag = decodeExact({ field: "tagB64", length: TAG_BYTES, value: header["tagB64"] });
  if (tag.isErr()) {
    return err(tag.error);
  }
  return ok({
    cipher: "aes-256-gcm",
    ivB64: iv.value.toString("base64"),
    kdf: "scrypt",
    keyBytes: KEY_BYTES,
    n: SCRYPT_N,
    p: SCRYPT_P,
    r: SCRYPT_R,
    saltB64: salt.value.toString("base64"),
    tagB64: tag.value.toString("base64"),
  });
}

/**
 * Decode one base64 header field and insist on its exact byte length — a salt or an IV of the wrong size is a
 * damaged header, not a cipher failure, and saying so early is what keeps the two apart.
 *
 * @param field the header field's name, for the message
 * @param length how many bytes it must decode to
 * @param value the raw field
 * @returns the decoded bytes, or why the field is not usable
 */
function decodeExact({
  field,
  length,
  value,
}: {
  field: string;
  length: number;
  value: unknown;
}): Result<Buffer, PassphraseEnvelopeError> {
  if (typeof value !== "string") {
    return err(PassphraseEnvelopeErrors.corrupt({ detail: `${field} is not a string` }));
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== length) {
    return err(
      PassphraseEnvelopeErrors.corrupt({
        detail: `${field} decodes to ${String(bytes.length)} byte(s), expected ${String(length)}`,
      }),
    );
  }
  return ok(bytes);
}

/**
 * Open an envelope with a passphrase, returning the plaintext it was sealed from.
 *
 * @param armoured the whole envelope
 * @param passphrase the single line pasted from the operator's password manager
 * @param magic the first line the caller expects
 * @returns the plaintext, or which way this failed
 */
export function openPassphraseEnvelope({
  armoured,
  passphrase,
  magic,
}: {
  armoured: Buffer;
  passphrase: string;
  magic: string;
}): Result<Buffer, PassphraseEnvelopeError> {
  const envelope = parsePassphraseEnvelope({ armoured, magic });
  if (envelope.isErr()) {
    return err(envelope.error);
  }
  const key = deriveKey({ passphrase, salt: Buffer.from(envelope.value.saltB64, "base64") });
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.value.ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.value.tagB64, "base64"));
  try {
    return ok(Buffer.concat([decipher.update(envelope.value.ciphertext), decipher.final()]));
  } catch {
    return err(PassphraseEnvelopeErrors.authenticationFailed());
  }
}
