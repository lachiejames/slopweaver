/**
 * Every object through this decorator reaches its destination as ciphertext under the backup key, and comes
 * back as verified plaintext — so a backup's chunk, blob, staging and sweep callers stay unchanged while
 * nothing they write is readable without the key (`./objectCrypto.ts` has the format).
 *
 * The only way to obtain a transport that encrypts is {@link encryptingTransport}, and it returns the
 * transport bundled with the scheme and key fingerprint. A caller that must never send plaintext — the Vault
 * leg — takes that bundle as its type, rather than inspecting a transport or trusting a boolean passed beside
 * one.
 *
 * Ciphertext and unverified plaintext are written only under a private temporary directory, removed on every
 * path, so a failed operation leaves neither beside the caller's files.
 */
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  decryptObjectFile,
  encryptObjectFile,
  keyFingerprint,
  OBJECT_SCHEME,
  plaintextLengthOf,
} from "./objectCrypto.js";
import { type ObjectCryptoError, ObjectCryptoErrors } from "./objectCryptoErrors.js";
import { carriesDotSegment, realPlace } from "./realPlace.js";
import type { BackupTransport } from "./transport.js";

/** A destination whose every object is encrypted, with what a manifest and receipt record about how. */
export interface EncryptedBackupDestination {
  readonly transport: BackupTransport;
  readonly scheme: typeof OBJECT_SCHEME;
  readonly keyFingerprint: string;
}

/**
 * Refuse a restore target that is itself a link, read without following it. A link would decrypt to wherever it
 * points, so one planted in a reused `retrieved/` directory would carry plaintext out of staging. `resolve` drops
 * a trailing separator first, since `lstat` of `link/` follows the link and would report its directory.
 *
 * @param objectName the object being downloaded, for the refusal
 * @param path the target as the caller named it
 * @returns nothing for a target that is no link (absence included), else the refusal — an unreadable parent can
 *   hide a link as well as anything else, so a target that cannot be examined is refused rather than thrown
 */
function refuseLinkAtTarget({
  objectName,
  path,
}: {
  objectName: string;
  path: string;
}): Result<void, ObjectCryptoError> {
  // Before `resolve` below erases one: `<dir>/link/../out` would be checked as `<dir>/out`.
  if (carriesDotSegment({ path })) {
    const why = "it carries a . or .. segment, which a restore target never needs";
    return err(ObjectCryptoErrors.targetUnresolvable({ objectName, path, why }));
  }
  let isLink: boolean;
  try {
    isLink = lstatSync(resolve(path), { throwIfNoEntry: false })?.isSymbolicLink() === true;
  } catch (cause: unknown) {
    const why = `it could not be examined: ${errorMessage({ error: cause })}`;
    return err(ObjectCryptoErrors.targetUnresolvable({ objectName, path, why }));
  }
  if (isLink) {
    const why = "it is a link, and a restore never writes through one";
    return err(ObjectCryptoErrors.targetUnresolvable({ objectName, path, why }));
  }
  return ok(undefined);
}

/**
 * Run one operation inside a fresh private temporary directory, removed afterwards whatever happened.
 *
 * @param work the operation, handed the directory
 * @returns whatever the operation returned
 */
async function inScratch<T>({ work }: { work: (args: { directory: string }) => Promise<T> }): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "sw-backup-object-"));
  try {
    return await work({ directory });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * The decrypting download: fetch the ciphertext into scratch, then decrypt it to the caller's path.
 *
 * @param inner the destination the ciphertext is read from
 * @param key the 32-byte backup key
 * @returns the download operation
 */
function decryptingDownload({ inner, key }: { inner: BackupTransport; key: Buffer }): BackupTransport["download"] {
  return async ({ objectName, path }) => {
    // A link AT the target is refused rather than resolved.
    const unlinked = refuseLinkAtTarget({ objectName, path });
    if (unlinked.isErr()) {
      return err(unlinked.error);
    }
    // Refused before any fetch: a decrypt renamed over a stored object would leave plaintext where ciphertext was.
    // Resolved once and decrypted to that SAME place, so a link re-pointed during the fetch redirects nothing.
    const resolved = realPlace({ path });
    if (resolved.isErr()) {
      return err(ObjectCryptoErrors.targetUnresolvable({ objectName, path, why: resolved.error.message }));
    }
    const target = resolved.value;
    if (inner.holds({ path: target })) {
      return err(ObjectCryptoErrors.targetInside({ objectName, path }));
    }
    return inScratch({
      work: async ({ directory }) => {
        const ciphertext = join(directory, "object.enc");
        const fetched = await inner.download({ objectName, path: ciphertext });
        if (fetched.isErr()) {
          return err(fetched.error);
        }
        return decryptObjectFile({ key, objectName, source: ciphertext, target });
      },
    });
  };
}

/**
 * The encrypting upload: seal the plaintext into scratch, store the ciphertext, report the plaintext's facts.
 *
 * @param inner the destination the ciphertext lands in
 * @param key the 32-byte backup key
 * @returns the upload operation
 */
function encryptingUpload({ inner, key }: { inner: BackupTransport; key: Buffer }): BackupTransport["upload"] {
  return async ({ path, objectName, bytes }) =>
    inScratch({
      work: async ({ directory }) => {
        const ciphertext = join(directory, "object.enc");
        const sealed = await encryptObjectFile({
          key,
          objectName,
          source: path,
          target: ciphertext,
          ...(bytes === undefined ? {} : { bytes }),
        });
        if (sealed.isErr()) {
          return err(sealed.error);
        }
        const stored = await inner.upload({ objectName, path: ciphertext });
        if (stored.isErr()) {
          return err(stored.error);
        }
        // What landed is checked against what was sealed HERE, because the facts handed up are the plaintext's:
        // a short or substituted ciphertext would otherwise be invisible to every check above this layer.
        const landed = stored.value;
        if (landed.bytes !== sealed.value.sealed.bytes || landed.sha256 !== sealed.value.sealed.sha256) {
          return err(
            ObjectCryptoErrors.landedWrong({
              landedBytes: landed.bytes,
              objectName,
              sealedBytes: sealed.value.sealed.bytes,
            }),
          );
        }
        // The destination's own facts about what landed, but the PLAINTEXT length and digest the caller measured.
        return ok({ ...landed, bytes: sealed.value.bytes, sha256: sealed.value.sha256 });
      },
    });
}

/**
 * Wrap a destination so every object written is encrypted under `key` and every object read is verified
 * and decrypted.
 *
 * @param inner the destination the ciphertext lands in
 * @param key the 32-byte backup key
 * @returns the encrypting transport, bundled with its scheme and the key's fingerprint
 */
export function encryptingTransport({
  inner,
  key,
}: {
  inner: BackupTransport;
  key: Buffer;
}): EncryptedBackupDestination {
  const transport: BackupTransport = {
    download: decryptingDownload({ inner, key }),
    holds: ({ path }) => inner.holds({ path }),
    list: async ({ prefix }) => inner.list({ prefix }),
    objectSizes: async ({ prefix }) => {
      const listed = await inner.objectSizes({ prefix });
      return listed.map((sizes) => {
        const plaintext = new Map<string, number>();
        for (const [name, ciphertextBytes] of sizes) {
          const length = plaintextLengthOf({ ciphertextBytes });
          // Too short to be a whole object: left out, so it reads as absent and is written again.
          if (length !== null) {
            plaintext.set(name, length);
          }
        }
        return plaintext;
      });
    },
    probe: async () => inner.probe(),
    remove: async ({ objectName }) => inner.remove({ objectName }),
    upload: encryptingUpload({ inner, key }),
  };
  return { keyFingerprint: keyFingerprint({ key }), scheme: OBJECT_SCHEME, transport };
}
