/**
 * The encrypted backup object format — every file a backup writes to its destination is one of these, so a
 * copy of the destination reads as noise to anyone without the key (owner ruling: everything uploaded reads
 * as garbage to anyone without that key).
 *
 * ## The format
 *
 * ```text
 * SWOBJ1\n           7 bytes   magic + format version; anything else is refused, never guessed at
 * key fingerprint    8 bytes   the first 8 bytes of sha256(key), so the right key is named before decrypting
 * IV                12 bytes   fresh per object
 * ciphertext         N bytes   AES-256-GCM over the plaintext, N = plaintext length
 * tag               16 bytes   GCM tag; the 27-byte header above is its additional authenticated data
 * ```
 *
 * The overhead is FIXED at {@link OBJECT_OVERHEAD_BYTES}, which is what lets a destination listing report a
 * plaintext length by subtraction ({@link plaintextLengthOf}) and keeps the content-addressed skip working
 * without reading every object back.
 *
 * ## Streaming, and why plaintext never replaces a file before the tag verifies
 *
 * The dump has been 0.9–1.5 GB, so neither direction holds a payload in one Buffer. Encryption streams the
 * file through the cipher. Decryption streams the ciphertext region into a private sibling temporary and
 * renames it over the target only once `final()` has verified the tag: GCM emits plaintext before it can
 * authenticate it, so an unverified byte may exist only under the temporary name, and is removed on failure.
 *
 * ## What stays visible
 *
 * Object names (content digests), the instant in each prefix, each object's exact length, how many there are
 * and which are shared between nights. A reader holding a candidate file can confirm it is present by its
 * digest. None of that reveals a byte of content.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync, readSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { err, ok, type Result } from "#lib/result.js";
import { fsyncFile, renameStagedFile } from "#lib/writeAtomic.js";

import { type ObjectCryptoError, ObjectCryptoErrors } from "./objectCryptoErrors.js";

/** The first line of every encrypted object: the magic, and the FORMAT version a reader must recognise. */
export const OBJECT_MAGIC = Buffer.from("SWOBJ1\n", "utf8");

/** The scheme name a manifest and receipt record for this format. */
export const OBJECT_SCHEME = "aes-256-gcm-stream-v1";

/** The key length AES-256 takes. */
export const BACKUP_KEY_BYTES = 32;

const FINGERPRINT_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Magic, fingerprint and IV — the bytes before the ciphertext, all authenticated as additional data. */
export const OBJECT_HEADER_BYTES = OBJECT_MAGIC.length + FINGERPRINT_BYTES + IV_BYTES;

/** Every byte an encrypted object carries beyond its plaintext. */
export const OBJECT_OVERHEAD_BYTES = OBJECT_HEADER_BYTES + TAG_BYTES;

/**
 * A key's fingerprint: the first 8 bytes of its sha256, as 16 lowercase hex characters. Names a key in a
 * manifest, a receipt and every object header without revealing it.
 *
 * @param key the 32-byte backup key
 * @returns the fingerprint
 */
export function keyFingerprint({ key }: { key: Buffer }): string {
  return createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, FINGERPRINT_BYTES * 2);
}

/**
 * The plaintext length an encrypted object of this physical length holds.
 *
 * @param ciphertextBytes the object's length on the destination
 * @returns the plaintext length, or `null` for an object too short to be a whole encrypted object
 */
export function plaintextLengthOf({ ciphertextBytes }: { ciphertextBytes: number }): number | null {
  if (ciphertextBytes < OBJECT_OVERHEAD_BYTES) {
    return null;
  }
  return ciphertextBytes - OBJECT_OVERHEAD_BYTES;
}

/**
 * Build the 27-byte header for one object.
 *
 * @param key the backup key, whose fingerprint the header names
 * @param iv this object's fresh IV
 * @returns the header bytes
 */
function encodeHeader({ key, iv }: { key: Buffer; iv: Buffer }): Buffer {
  const fingerprint = createHash("sha256").update(key).digest().subarray(0, FINGERPRINT_BYTES);
  return Buffer.concat([OBJECT_MAGIC, fingerprint, iv]);
}

/**
 * The fingerprint of the key an object was written under, read off its header with no key in hand — how a
 * recovery picks which wrapped key opens a backup before it holds any key at all.
 *
 * @param header the object's first {@link OBJECT_HEADER_BYTES} bytes, or more
 * @param objectName the object, for the message
 * @returns the 16-character lowercase fingerprint, or `OBJECT_NOT_ENCRYPTED` for a header that is not SWOBJ1
 */
export function objectFingerprintOf({
  header,
  objectName,
}: {
  header: Buffer;
  objectName: string;
}): Result<string, ObjectCryptoError> {
  if (header.length < OBJECT_HEADER_BYTES || !header.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)) {
    return err(ObjectCryptoErrors.notEncrypted({ objectName }));
  }
  return ok(header.subarray(OBJECT_MAGIC.length, OBJECT_MAGIC.length + FINGERPRINT_BYTES).toString("hex"));
}

/**
 * Read an object's header and check it names this key.
 *
 * @param header the object's first {@link OBJECT_HEADER_BYTES} bytes
 * @param key the key in hand
 * @param objectName the object, for the message
 * @returns the IV, or why the object cannot be opened with this key
 */
function parseObjectHeader({
  header,
  key,
  objectName,
}: {
  header: Buffer;
  key: Buffer;
  objectName: string;
}): Result<{ iv: Buffer }, ObjectCryptoError> {
  const fingerprint = objectFingerprintOf({ header, objectName });
  if (fingerprint.isErr()) {
    return err(fingerprint.error);
  }
  const found = fingerprint.value;
  const expected = keyFingerprint({ key });
  if (found !== expected) {
    return err(ObjectCryptoErrors.keyMismatch({ expectedFingerprint: expected, foundFingerprint: found, objectName }));
  }
  return ok({ iv: Buffer.from(header.subarray(OBJECT_MAGIC.length + FINGERPRINT_BYTES, OBJECT_HEADER_BYTES)) });
}

/**
 * A pass-through stream that counts and hashes every byte crossing it.
 *
 * @returns the stream, and a reader of the length and sha256 seen once it has drained
 */
function countingTap(): { stream: Transform; facts: () => { bytes: number; sha256: string } } {
  const digest = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      digest.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  return { facts: () => ({ bytes, sha256: digest.digest("hex") }), stream };
}

/**
 * Encrypt a local file — bounded to its first `bytes` when given — into a new file, hashing the plaintext
 * as it passes so the caller can compare it with what it measured.
 *
 * @param source the plaintext file
 * @param bytes how many leading bytes to encrypt; the whole file when absent
 * @param target where the encrypted object is written; must not exist
 * @param key the backup key
 * @param objectName the object, for the message
 * @returns the plaintext length and sha256, the written object's own length and sha256 (so a caller can check
 *   that what a destination stored is what was sealed), or why it could not be written
 */
export async function encryptObjectFile({
  source,
  bytes,
  target,
  key,
  objectName,
}: {
  source: string;
  bytes?: number;
  target: string;
  key: Buffer;
  objectName: string;
}): Promise<Result<{ bytes: number; sha256: string; sealed: { bytes: number; sha256: string } }, ObjectCryptoError>> {
  try {
    const iv = randomBytes(IV_BYTES);
    const header = encodeHeader({ iv, key });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    const tap = countingTap();
    const tapSealed = countingTap();
    // `end` is INCLUSIVE, so a bound of n reads through index n-1; a bound of zero encrypts nothing at all.
    const plaintext =
      bytes === 0
        ? Readable.from([])
        : createReadStream(source, bytes === undefined ? {} : { end: bytes - 1, start: 0 });
    // One exclusive write of header, ciphertext and tag, in order: the tag exists once the cipher has flushed,
    // which is exactly when its output is exhausted.
    await pipeline(
      plaintext,
      tap.stream,
      cipher,
      // named-object-params-exempt: stream/promises pipeline hands a transform its source iterable positionally
      async function* (sealed: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        yield header;
        yield* sealed;
        yield cipher.getAuthTag();
      },
      tapSealed.stream,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    return ok({ ...tap.facts(), sealed: tapSealed.facts() });
  } catch (cause: unknown) {
    return err(ObjectCryptoErrors.encryptFailed({ cause, objectName }));
  }
}

/**
 * Read `length` bytes at `position` of a file.
 *
 * @param path the file
 * @param position the offset to read from
 * @param length how many bytes
 * @returns the bytes read, which may be fewer at end of file
 */
function readRange({ path, position, length }: { path: string; position: number; length: number }): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(descriptor, buffer, 0, length, position);
    return buffer.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Decrypt an encrypted object file into `target`, which gains the plaintext only once the tag verifies.
 *
 * @param source the encrypted object, already local
 * @param target where the plaintext lands; left untouched on any failure
 * @param key the backup key
 * @param objectName the object, for the message
 * @returns nothing, or why the object could not be opened
 */
export async function decryptObjectFile({
  source,
  target,
  key,
  objectName,
}: {
  source: string;
  target: string;
  key: Buffer;
  objectName: string;
}): Promise<Result<void, ObjectCryptoError>> {
  const opened = openedObject({ key, objectName, source });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const { header, iv, size } = opened.value;
  const tag = readRange({ length: TAG_BYTES, path: source, position: size - TAG_BYTES });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const temporary = join(dirname(target), `.partial-${basename(target)}-${randomUUID()}`);
  const ciphertextEnd = size - TAG_BYTES - 1;
  const ciphertext =
    ciphertextEnd < OBJECT_HEADER_BYTES
      ? Readable.from([])
      : createReadStream(source, { end: ciphertextEnd, start: OBJECT_HEADER_BYTES });
  try {
    await pipeline(ciphertext, decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    fsyncFile({ path: temporary });
    renameStagedFile({ flushDirectory: true, from: temporary, to: target });
    return ok(undefined);
  } catch (cause: unknown) {
    rmSync(temporary, { force: true });
    // Node's one message for a GCM tag that did not verify: "Unsupported state or unable to authenticate data".
    if (cause instanceof Error && cause.message.includes("unable to authenticate")) {
      return err(ObjectCryptoErrors.authenticationFailed({ objectName }));
    }
    return err(ObjectCryptoErrors.decryptFailed({ cause, objectName }));
  }
}

/**
 * Check an encrypted object's size and header before any byte of it is decrypted.
 *
 * @param source the encrypted object, already local
 * @param key the key in hand
 * @param objectName the object, for the message
 * @returns its header, IV and size, or why it is not a whole object under this key
 */
function openedObject({
  source,
  key,
  objectName,
}: {
  source: string;
  key: Buffer;
  objectName: string;
}): Result<{ header: Buffer; iv: Buffer; size: number }, ObjectCryptoError> {
  let size = 0;
  try {
    size = statSync(source).size;
  } catch (cause: unknown) {
    return err(ObjectCryptoErrors.decryptFailed({ cause, objectName }));
  }
  if (size < OBJECT_HEADER_BYTES) {
    return err(shortObjectError({ objectName, opened: readRange({ length: size, path: source, position: 0 }) }));
  }
  const header = readRange({ length: OBJECT_HEADER_BYTES, path: source, position: 0 });
  const parsed = parseObjectHeader({ header, key, objectName });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (size < OBJECT_OVERHEAD_BYTES) {
    return err(ObjectCryptoErrors.truncated({ bytes: size, objectName }));
  }
  return ok({ header, iv: parsed.value.iv, size });
}

/**
 * Why an object too short for a header cannot be opened.
 *
 * @param opened every byte the object has
 * @param objectName the object, for the message
 * @returns "truncated" when it opens with the magic, "not encrypted" otherwise
 */
function shortObjectError({ opened, objectName }: { opened: Buffer; objectName: string }): ObjectCryptoError {
  const opensWithMagic =
    opened.length >= OBJECT_MAGIC.length && opened.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC);
  if (opensWithMagic) {
    return ObjectCryptoErrors.truncated({ bytes: opened.length, objectName });
  }
  return ObjectCryptoErrors.notEncrypted({ objectName });
}
