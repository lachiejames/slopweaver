/**
 * The files leg of a restore: rebuilding the corpus roots a backup's `files.json` names, by digest.
 *
 * Its own module beside {@link runRestoreSecrets}, for the reason the gate asks for a seam rather than a
 * shorter file: the database half answers to a connection string, this half answers to a destination full of
 * content-addressed blobs, and neither needs to read the other.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { renameStagedFile } from "#lib/writeAtomic.js";

import { rebuildChunkedFile } from "./chunkRestore.js";
import { type BackupError, BackupErrors } from "./errors.js";
import {
  type BackedUpFile,
  blobObjectName,
  FILES_MANIFEST,
  type FilesManifest,
  filesDifferences,
  type ManifestFile,
  parseFilesManifest,
  SUPABASE_PROJECT_ID,
} from "./plan.js";
import type { RestoreSource } from "./restoreSource.js";
import { digestFile, readSmallFile } from "./stack.js";
import type { BackupTransport } from "./transport.js";

/**
 * What restoring the files leg did. Reached only when EVERY digest matched.
 *
 * There is deliberately no differences field on this report. A mismatch is an `err`, not a value a caller
 * has to remember to branch on: the database half already refuses before it writes a byte
 * ({@link verifyBackupDirectory}), and a files half that merely REPORTED the same class of corruption would
 * let a library caller treat a bad restore as a good one. */
export interface FilesRestoreReport {
  readonly into: string;
  readonly count: number;
  readonly bytes: number;
}

/**
 * Fetch every file a backup's `files.json` names into a directory, by digest, and verify each one.
 *
 * Into a directory the caller names rather than over the live home: putting bronze back where it lives is
 * the last step of a disaster recovery and a copy is what a proof compares. The manifest comes from the
 * source directory (downloaded with the rest when the source is a destination); the blobs always come from the
 * destination, because a staged backup never copied them — they were already on this disk.
 *
 * @param source where the manifest is, and which destination the blobs are in
 * @param into the directory to rebuild the roots under
 * @param transport the destination
 * @param digest the digest effect
 * @returns what came back and whether it matched
 */
export async function runRestoreFiles({
  source,
  into,
  transport,
  digest = digestFile,
}: {
  source: RestoreSource;
  into: string;
  transport: BackupTransport;
  digest?: typeof digestFile;
}): Promise<Result<FilesRestoreReport, BackupError>> {
  // An empty or absent target only: every file the restore then finds under it is one it wrote itself, so no
  // link or earlier file already there can redirect a write or pass for a restored file.
  if (existsSync(into) && readdirSync(into).length > 0) {
    return err(BackupErrors.filesTargetNotEmpty({ into }));
  }
  const manifest = readFilesManifest({ directory: source.directory });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const restored: BackedUpFile[] = [];
  for (const file of manifest.value.files) {
    const target = join(into, file.relativePath);
    mkdirSync(join(target, ".."), { mode: 0o700, recursive: true });
    const fetched = await fetchFile({ file, into, target, transport });
    if (fetched.isErr()) {
      return err(fetched.error);
    }
    const digested = digest({ path: target });
    if (digested.isErr()) {
      rmSync(target, { force: true });
      return err(digested.error);
    }
    // A file that is not what files.json recorded is reported below and never left at its path.
    if (digested.value.sha256 !== file.sha256 || digested.value.bytes !== file.bytes) {
      rmSync(target, { force: true });
    }
    restored.push({ bytes: digested.value.bytes, relativePath: file.relativePath, sha256: digested.value.sha256 });
  }
  const differences = filesDifferences({ manifest: manifest.value.files, restored });
  if (differences.length > 0) {
    return err(BackupErrors.filesMismatched({ differences, manifest: FILES_MANIFEST, restored: restored.length }));
  }
  return ok({ bytes: restored.reduce((sum, file) => sum + file.bytes, 0), count: restored.length, into });
}

/**
 * Read and parse the `files.json` a downloaded backup directory holds.
 *
 * @param directory where the backup's manifests were downloaded
 * @returns the parsed manifest, or why it could not be read or is not one
 */
function readFilesManifest({ directory }: { directory: string }): Result<FilesManifest, BackupError> {
  const text = readSmallFile({ path: join(directory, FILES_MANIFEST) });
  if (text.isErr()) {
    return err(text.error);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.value);
  } catch {
    return err(BackupErrors.fileNotJson({ directory, file: FILES_MANIFEST }));
  }
  return parseFilesManifest({ value: decoded });
}

/**
 * Put one backed-up file at its target: its blob downloaded, or its chunks rebuilt. Checked by the caller.
 *
 * @param file the manifest's entry
 * @param into the restore directory, which a chunk is downloaded into before it is decoded
 * @param target where the file goes
 * @param transport the destination
 * @returns nothing, or why the file could not be fetched
 */
async function fetchFile({
  file,
  into,
  target,
  transport,
}: {
  file: ManifestFile;
  into: string;
  target: string;
  transport: BackupTransport;
}): Promise<Result<void, BackupError>> {
  if (file.chunked !== null) {
    const rebuilt = await rebuildChunkedFile({
      content: file.chunked,
      project: SUPABASE_PROJECT_ID,
      scratch: into,
      target,
      transport,
    });
    if (rebuilt.isErr()) {
      return err(BackupErrors.stepFailed({ reasons: rebuilt.error }));
    }
    return ok(undefined);
  }
  // Downloaded beside the target and renamed into place, so a download that dies part-way leaves no
  // truncated file at the path — the promise `rebuildChunkedFile` keeps for a chunked one.
  const partial = `${target}.partial`;
  try {
    rmSync(partial, { force: true });
    const fetched = await transport.download({
      objectName: blobObjectName({ project: SUPABASE_PROJECT_ID, sha256: file.sha256 }),
      path: partial,
    });
    if (fetched.isErr()) {
      return err(BackupErrors.transportFailed({ transportError: fetched.error }));
    }
    // The download's bytes reach the device before the name does, as `renameStagedFile` expects of its caller.
    const handle = openSync(partial, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameStagedFile({ flushDirectory: true, from: partial, to: target });
    return ok(undefined);
  } finally {
    rmSync(partial, { force: true });
  }
}
