/**
 * The backup key's wrap at the destination — present beside every backup, written once and never replaced, and read to open one with the master
 * password instead of this Mac's Keychain. The thin effectful shell over `./keyWrap.ts`, moving bytes only through
 * the PLAIN transport: the wrap is what opens the key, so it cannot itself sit under the key.
 *
 * Every scratch file lives in a private temporary directory removed on every path, and nothing here widens
 * {@link BackupTransport}: reading a manifest's header is one small download, then a read of its first bytes.
 */
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type EncryptedBackupDestination, encryptingTransport } from "./encryptingTransport.js";
import { backupKeyWrapObjectName, unwrapBackupKey, wrapBackupKey } from "./keyWrap.js";
import { type KeyWrapError, KeyWrapErrors } from "./keyWrapErrors.js";
import { keyFingerprint, OBJECT_HEADER_BYTES, objectFingerprintOf } from "./objectCrypto.js";
import { BACKUP_FILES } from "./plan.js";
import type { BackupTransport, StoredObject } from "./transport.js";

/** A destination backup opened with the master password: the key it was written under, and the reader over it. */
export interface OpenedDestinationBackup {
  readonly fingerprint: string;
  readonly key: Buffer;
  readonly destination: EncryptedBackupDestination;
}

/**
 * Run one operation inside a fresh private temporary directory, removed afterwards whatever happened. A directory
 * that cannot be made, and anything the operation throws, is a returned failure naming the object the operation
 * was for, never a throw past the caller's reason lines.
 *
 * @param objectName the object the operation reads or writes, named in the failure
 * @param work the operation, handed the directory
 * @returns whatever the operation returned, or why the scratch directory could not be made or used
 */
async function inScratch<T>({
  objectName,
  work,
}: {
  objectName: string;
  work: (args: { directory: string }) => Promise<Result<T, KeyWrapError>>;
}): Promise<Result<T, KeyWrapError>> {
  let directory: string;
  try {
    directory = mkdtempSync(join(tmpdir(), "sw-key-wrap-"));
  } catch (cause: unknown) {
    return err(
      KeyWrapErrors.transportFailed({
        detail: `no private scratch directory could be made: ${errorMessage({ error: cause })}`,
        objectName,
      }),
    );
  }
  try {
    return await work({ directory });
  } catch (cause: unknown) {
    // Every scratch-file read and write inside `work` is local I/O that can throw — a downloaded wrap removed
    // before it is read, say — so the one boundary catches them all rather than each call site.
    return err(
      KeyWrapErrors.transportFailed({
        detail: `a scratch file could not be used: ${errorMessage({ error: cause })}`,
        objectName,
      }),
    );
  } finally {
    // A throw here would replace whatever `work` returned, so a scratch directory that will not go is left for the
    // OS temp sweep: it holds only sealed bytes, a wrap or an encrypted object's header.
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch {
      // Deliberately swallowed: see above.
    }
  }
}

/**
 * Wrap the key under the master password and write the wrap to the destination. Callers write only where no wrap
 * of this key stands — `--create-master-password` refuses one, and {@link ensureBackupKeyWrap} opens it instead.
 *
 * @param key the 32-byte backup key
 * @param password the master password
 * @param project the project segment the wrap is filed under
 * @param transport the PLAIN destination
 * @returns what landed, or why it did not
 */
export async function writeBackupKeyWrap({
  key,
  password,
  project,
  transport,
}: {
  key: Buffer;
  password: string;
  project: string;
  transport: BackupTransport;
}): Promise<Result<StoredObject, KeyWrapError>> {
  const objectName = backupKeyWrapObjectName({ fingerprint: keyFingerprint({ key }), project });
  const wrapped = wrapBackupKey({ key, password });
  if (wrapped.isErr()) {
    return err(wrapped.error);
  }
  return inScratch({
    objectName,
    work: async ({ directory }) => {
      const path = join(directory, "key.wrap");
      try {
        writeFileSync(path, wrapped.value, { flag: "wx", mode: 0o600 });
      } catch (cause: unknown) {
        return err(KeyWrapErrors.transportFailed({ detail: errorMessage({ error: cause }), objectName }));
      }
      const stored = await transport.upload({ objectName, path });
      if (stored.isErr()) {
        return err(KeyWrapErrors.transportFailed({ detail: stored.error.message, objectName }));
      }
      if (stored.value.bytes !== wrapped.value.length) {
        return err(
          KeyWrapErrors.transportFailed({
            detail: `${String(stored.value.bytes)} bytes landed of ${String(wrapped.value.length)}`,
            objectName,
          }),
        );
      }
      return ok(stored.value);
    },
  });
}

/**
 * Whether the destination holds a wrap of the key with this fingerprint.
 *
 * @param fingerprint the key's fingerprint
 * @param project the project segment the wrap is filed under
 * @param transport the PLAIN destination
 * @returns whether the wrap is there, or why the destination could not be listed
 */
export async function destinationHasKeyWrap({
  fingerprint,
  project,
  transport,
}: {
  fingerprint: string;
  project: string;
  transport: BackupTransport;
}): Promise<Result<boolean, KeyWrapError>> {
  const objectName = backupKeyWrapObjectName({ fingerprint, project });
  // List the whole `keys/` directory and match ignoring case: on a case-insensitive volume (APFS by default) a wrap
  // filed in another case IS this object, and an exact-string prefix test would miss it and let a write replace it.
  // On a case-sensitive one a differently-cased wrap then reads as present and fails to open, which
  // refuses the run rather than writing beside it.
  const listed = await transport.list({ prefix: objectName.slice(0, objectName.lastIndexOf("/") + 1) });
  if (listed.isErr()) {
    return err(KeyWrapErrors.transportFailed({ detail: listed.error.message, objectName }));
  }
  const wanted = objectName.toLowerCase();
  return ok(listed.value.some((name) => name.toLowerCase() === wanted));
}

/**
 * Fetch one key's wrap from the destination and unwrap it with the master password.
 *
 * @param directory a private scratch directory the wrap is downloaded into
 * @param fingerprint the fingerprint the unwrapped key must carry
 * @param objectName the wrap's object name
 * @param password the master password
 * @param transport the PLAIN destination
 * @returns the key, or why the wrap could not be read or opened
 */
async function readKeyWrap({
  directory,
  fingerprint,
  objectName,
  password,
  transport,
}: {
  directory: string;
  fingerprint: string;
  objectName: string;
  password: string;
  transport: BackupTransport;
}): Promise<Result<Buffer, KeyWrapError>> {
  const path = join(directory, "key.wrap");
  const fetched = await transport.download({ objectName, path });
  if (fetched.isErr()) {
    return err(KeyWrapErrors.transportFailed({ detail: fetched.error.message, objectName }));
  }
  return unwrapBackupKey({ armoured: readFileSync(path), expectedFingerprint: fingerprint, objectName, password });
}

/**
 * Make sure the destination holds this key's wrap, NEVER replacing one. An absent wrap is written. A present one is
 * opened with the password and left byte for byte as it was, so a nightly run rewrites nothing. A present wrap this
 * password does not open is refused: the password on this Mac is then not the one the wrap was sealed under, and
 * re-wrapping would strand the one the operator saved in their password manager. Two runs racing on a destination
 * with no wrap can both write one; both are this key under this password, and the read-back proves whichever
 * landed opens.
 *
 * @param key the 32-byte backup key
 * @param password the master password the run read once
 * @param project the project segment the wrap is filed under
 * @param transport the PLAIN destination
 * @returns the wrap's object name and whether this call wrote it, or why the wrap is missing or does not open
 */
export async function ensureBackupKeyWrap({
  key,
  password,
  project,
  transport,
}: {
  key: Buffer;
  password: string;
  project: string;
  transport: BackupTransport;
}): Promise<Result<{ objectName: string; state: "written" | "present" }, KeyWrapError>> {
  const fingerprint = keyFingerprint({ key });
  const objectName = backupKeyWrapObjectName({ fingerprint, project });
  const held = await destinationHasKeyWrap({ fingerprint, project, transport });
  if (held.isErr()) {
    return err(held.error);
  }
  let state: "written" | "present" = "present";
  if (!held.value) {
    const written = await writeBackupKeyWrap({ key, password, project, transport });
    if (written.isErr()) {
      return err(written.error);
    }
    state = "written";
  }
  // Read back even what this call just wrote: `store backup` holds no lock, so a run racing this one may have
  // landed its own wrap between the check and the write. One under the same password is an equivalent wrap of the
  // same key and opens here; one under any other password does not, and the run is refused.
  return inScratch({
    objectName,
    work: async ({ directory }) =>
      (await readKeyWrap({ directory, fingerprint, objectName, password, transport })).map(() => ({
        objectName,
        state,
      })),
  });
}

/**
 * Read the first {@link OBJECT_HEADER_BYTES} of a local file.
 *
 * @param path the file
 * @returns the bytes read, fewer for a shorter file
 */
function readHeader({ path }: { path: string }): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(OBJECT_HEADER_BYTES);
    const read = readSync(descriptor, buffer, 0, OBJECT_HEADER_BYTES, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * The fingerprint of the key one backup was written under, read off its encrypted manifest's header.
 *
 * @param prefix the backup's prefix, `<project>/<instant>/`
 * @param transport the PLAIN destination
 * @param directory a private scratch directory
 * @returns the fingerprint, or why it could not be read
 */
async function backupFingerprint({
  prefix,
  transport,
  directory,
}: {
  prefix: string;
  transport: BackupTransport;
  directory: string;
}): Promise<Result<string, KeyWrapError>> {
  const objectName = `${prefix}${BACKUP_FILES.manifest}`;
  const path = join(directory, "manifest.enc");
  const fetched = await transport.download({ objectName, path });
  if (fetched.isErr()) {
    return err(KeyWrapErrors.transportFailed({ detail: fetched.error.message, objectName }));
  }
  return objectFingerprintOf({ header: readHeader({ path }), objectName }).mapErr((error) =>
    KeyWrapErrors.transportFailed({ detail: error.message, objectName }),
  );
}

/**
 * Open one destination backup with the master password: read which key its manifest was written under, fetch that
 * key's wrap, unwrap it, and build the decrypting reader. There is no Keychain fallback — a destination with no wrap
 * refuses, naming the verb that writes one.
 *
 * @param password the master password, read once by the caller
 * @param prefix the backup's prefix, `<project>/<instant>/`
 * @param project the project segment the wrap is filed under
 * @param transport the PLAIN destination
 * @returns the key and the decrypting reader, or why the backup could not be opened
 */
export async function openDestinationBackup({
  password,
  prefix,
  project,
  transport,
}: {
  password: string;
  prefix: string;
  project: string;
  transport: BackupTransport;
}): Promise<Result<OpenedDestinationBackup, KeyWrapError>> {
  const normalised = prefix.endsWith("/") ? prefix : `${prefix}/`;
  // The wrap's name is not known until the backup's own header is read, so a scratch failure names the backup.
  return inScratch({
    objectName: normalised,
    work: async ({ directory }) => {
      const fingerprint = await backupFingerprint({ directory, prefix: normalised, transport });
      if (fingerprint.isErr()) {
        return err(fingerprint.error);
      }
      const objectName = backupKeyWrapObjectName({ fingerprint: fingerprint.value, project });
      const held = await destinationHasKeyWrap({ fingerprint: fingerprint.value, project, transport });
      if (held.isErr()) {
        return err(held.error);
      }
      if (!held.value) {
        return err(KeyWrapErrors.absent({ fingerprint: fingerprint.value, objectName }));
      }
      const key = await readKeyWrap({ directory, fingerprint: fingerprint.value, objectName, password, transport });
      if (key.isErr()) {
        return err(key.error);
      }
      return ok({
        destination: encryptingTransport({ inner: transport, key: key.value }),
        fingerprint: fingerprint.value,
        key: key.value,
      });
    },
  });
}
