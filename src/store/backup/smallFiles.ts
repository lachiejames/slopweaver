/**
 * The files leg's small files: each one frozen and digested ONCE, kept under its digest, and sent as ONE blob to
 * every destination that lacks it. Why a file is frozen before it is hashed, why the snapshot outlives a send, and
 * why the held test lists the prefix once, is `./filesLeg.ts`'s header; a large file goes through `./largeFiles.ts`.
 */
import { constants, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import { backupErrorLines } from "./errors.js";
import { fileVanished } from "./fileRace.js";
import { backedUpFilePath } from "./files.js";
import { frozenBlobPath } from "./filesLeg.js";
import { type BackedUpFile, blobObjectName, blobPrefix, blobsHeld, SUPABASE_PROJECT_ID } from "./plan.js";
import type { BackupDeps } from "./run.js";
import { type BackupTransport, type StoredObject, uploadRetried } from "./transport.js";
import { type BackupUploadError, BackupUploadErrors } from "./uploadErrors.js";

/** What freezing one live file settled: the entry its clone measures, or that it was already gone. */
type FreezeBlobOutcome = { readonly kind: "frozen"; readonly file: BackedUpFile } | { readonly kind: "vanished" };

/** What sending one destination its missing blobs did. */
export interface SentBlobs {
  readonly uploaded: number;
  readonly uploadedBytes: number;
  /** Entries this destination lacks whose frozen copy is not in the snapshot — a staging from before the split. */
  readonly unsourced: readonly string[];
}

/**
 * Freeze every small file into the snapshot and digest the CLONE, keeping each under its frozen digest.
 *
 * A file gone before its clone is left out and counted; any other clone failure stops the leg.
 *
 * @param files the small entries the walk measured
 * @param home the Slopweaver home the files live under
 * @param snapshot the staging's snapshot directory, its `blobs/` already made
 * @param digest the digest effect
 * @returns every surviving entry as its clone measures it, in walk order, and how many vanished; or the first
 *   that could not be frozen
 */
export function freezeSmallFiles({
  files,
  home,
  snapshot,
  digest,
}: {
  files: readonly BackedUpFile[];
  home: string;
  snapshot: string;
  digest: BackupDeps["digestFile"];
}): Result<{ entries: readonly BackedUpFile[]; vanished: number }> {
  const entries: BackedUpFile[] = [];
  let vanished = 0;
  for (const [index, walked] of files.entries()) {
    const incoming = join(snapshot, `incoming-${String(index)}`);
    const frozen = freezeBlob({
      digest,
      frozenPath: incoming,
      livePath: backedUpFilePath({ home, relativePath: walked.relativePath }),
      relativePath: walked.relativePath,
    });
    if (frozen.isErr()) {
      return err(frozen.error);
    }
    if (frozen.value.kind === "vanished") {
      vanished += 1;
      continue;
    }
    const file = frozen.value.file;
    const kept = frozenBlobPath({ sha256: file.sha256, snapshot });
    if (existsSync(kept)) {
      rmSync(incoming, { force: true });
    } else {
      renameSync(incoming, kept);
    }
    entries.push(file);
  }
  return ok({ entries, vanished });
}

/**
 * Send one destination the small files' blobs it lacks, from one listing of the blob prefix, each distinct digest
 * once, from the frozen copies. Never rewrites `files.json` and never removes a frozen copy.
 *
 * @param entries the small entries `files.json` names
 * @param snapshot the staging's snapshot directory
 * @param retry how a failed upload is retried
 * @param transport the destination
 * @returns what was sent and which entries had no frozen copy to send from, or why the leg stopped
 */
export async function sendSmallFiles({
  entries,
  snapshot,
  retry,
  transport,
}: {
  entries: readonly BackedUpFile[];
  snapshot: string;
  retry: RetryPolicy;
  transport: BackupTransport;
}): Promise<Result<SentBlobs>> {
  const held = await blobsAlreadyHeld({ files: entries, transport });
  if (held.isErr()) {
    return err(held.error);
  }
  const sent = new Set<string>();
  const unsourced: string[] = [];
  let uploadedBytes = 0;
  for (const file of entries) {
    if (held.value.has(file.sha256) || sent.has(file.sha256)) {
      continue;
    }
    const frozenPath = frozenBlobPath({ sha256: file.sha256, snapshot });
    if (!existsSync(frozenPath)) {
      unsourced.push(file.relativePath);
      continue;
    }
    const landed = await sendFrozenBlob({ file, frozenPath, retry, transport });
    if (landed.isErr()) {
      return err(landed.error);
    }
    sent.add(file.sha256);
    uploadedBytes += file.bytes;
  }
  return ok({ unsourced, uploaded: sent.size, uploadedBytes });
}

/**
 * Which blobs the destination already holds AT THE RIGHT LENGTH under their digest, from ONE listing of the
 * blob prefix — a wrong length is not held, so it re-uploads ({@link blobsHeld} says why).
 *
 * @param files every backed-up file the manifest names
 * @param transport the destination
 * @returns the digests that need no upload, or why the listing failed
 */
export async function blobsAlreadyHeld({
  files,
  transport,
}: {
  files: readonly BackedUpFile[];
  transport: BackupTransport;
}): Promise<Result<ReadonlySet<string>>> {
  const sizes = await transport.objectSizes({ prefix: blobPrefix({ project: SUPABASE_PROJECT_ID }) });
  if (sizes.isErr()) {
    return err([sizes.error.message]);
  }
  return ok(blobsHeld({ files, project: SUPABASE_PROJECT_ID, sizes: sizes.value }));
}

/**
 * Clone one live file into the snapshot and digest the CLONE, so the entry describes bytes nothing else can
 * rewrite before they are sent.
 *
 * @param livePath the file under the home
 * @param frozenPath where its clone goes
 * @param relativePath the entry's path, as the manifest records it
 * @param digest the digest effect
 * @returns the entry as the clone measures it, `vanished` when the live file was already gone, or why the
 *   file could not be frozen
 */
function freezeBlob({
  livePath,
  frozenPath,
  relativePath,
  digest,
}: {
  livePath: string;
  frozenPath: string;
  relativePath: string;
  digest: BackupDeps["digestFile"];
}): Result<FreezeBlobOutcome> {
  try {
    copyFileSync(livePath, frozenPath, constants.COPYFILE_FICLONE);
  } catch (cause: unknown) {
    if (fileVanished({ cause, into: dirname(frozenPath), path: livePath })) {
      return ok({ kind: "vanished" });
    }
    return err([BackupUploadErrors.blobUnfrozen({ cause, relativePath }).message]);
  }
  const digested = digest({ path: frozenPath });
  if (digested.isErr()) {
    return err(backupErrorLines({ error: digested.error }));
  }
  return ok({ file: { bytes: digested.value.bytes, relativePath, sha256: digested.value.sha256 }, kind: "frozen" });
}

/**
 * Send one frozen blob under its own digest, and take it back out when what landed is not what was frozen.
 *
 * The clone cannot change under the upload, so a mismatch here is the transport's, not a resync's — and it
 * is still refused rather than trusted, because a name-and-length match would let the skip test trust the
 * wrong bytes on every later night.
 *
 * @param file the entry as the clone measured it
 * @param frozenPath the clone
 * @param retry how a failed upload is retried
 * @param transport the destination
 * @returns nothing, or why the blob did not land as its name
 */
async function sendFrozenBlob({
  file,
  frozenPath,
  retry,
  transport,
}: {
  file: BackedUpFile;
  frozenPath: string;
  retry: RetryPolicy;
  transport: BackupTransport;
}): Promise<Result<void>> {
  const objectName = blobObjectName({ project: SUPABASE_PROJECT_ID, sha256: file.sha256 });
  const sent = await uploadRetried({ bytes: file.bytes, objectName, path: frozenPath, retry, transport });
  if (sent.isErr()) {
    return err(backupErrorLines({ error: sent.error }));
  }
  const mismatch = blobMismatch({ file, sent: sent.value });
  if (mismatch === null) {
    return ok(undefined);
  }
  const removed = await transport.remove({ objectName });
  if (removed.isErr()) {
    // The ONE path that leaves a wrong object in the destination, so the message carries the object, why the
    // removal failed and what a person has to do. A reader who sees only "deleting … failed" has no
    // reason to know a blob that does not hash to its own name is sitting there for the next run.
    return err([BackupUploadErrors.blobLeftBehind({ mismatch, objectName, why: removed.error.message }).message]);
  }
  return err([mismatch.message]);
}

/**
 * Why one landed blob is not the file its object name claims, or `null` when it is. Pure.
 *
 * @param file what the frozen copy measured
 * @param sent what the transport reports it sent
 * @returns the typed mismatch, or `null`
 */
function blobMismatch({ file, sent }: { file: BackedUpFile; sent: StoredObject }): BackupUploadError | null {
  if (sent.bytes !== file.bytes) {
    return BackupUploadErrors.blobShort({ expected: file.bytes, held: sent.bytes, relativePath: file.relativePath });
  }
  if (sent.sha256 !== file.sha256) {
    return BackupUploadErrors.blobRewritten({
      named: file.sha256,
      relativePath: file.relativePath,
      sent: sent.sha256,
    });
  }
  return null;
}
