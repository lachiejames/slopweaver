/**
 * The files leg of a backup: walking the backed-up roots, freezing every file ONCE, writing the `files.json` that
 * names them, and sending each destination the blobs and chunks it does not already hold.
 *
 * Its own module beside `restoreFiles.ts`, which reads what this writes. What splits it from the rest of
 * `run.ts` is the addressing: the dump and the tar are one object each at a known name, while this half
 * is content-addressed and has to ask the destination what it already has. The two halves are
 * `./filesPrepare.ts` (once a night) and `./filesSend.ts` (once per destination); this file holds what both read.
 *
 * ## Prepared once, sent to every destination
 *
 * A night writes to a LIST of destinations — this Mac's folder and the pinned SSD — and both must receive the
 * same `files.json`, byte for byte. So every file is frozen and digested BEFORE the first destination is written,
 * the final `files.json` is written once from those frozen digests, and a send only lists, diffs and uploads: it
 * never rewrites the manifest and never deletes a frozen copy. A file rewritten between the walk and its freeze
 * gets one frozen digest, and that is the one both destinations receive.
 *
 * ## A blob is FROZEN before it is hashed, so a resync cannot fail the night
 *
 * MEASURED on a nightly run: a resync rewrote `atlas/linear/manifest.json` between the walk's
 * digest and its upload, the bytes sent hashed to one digest under an object named for another, and the
 * whole backup failed `BLOB_REWRITTEN` — dump included. Each file is therefore cloned into `<staging>/snapshot/`
 * (`COPYFILE_FICLONE`: an APFS clone costs no bytes until the live file changes, and another filesystem falls back
 * to a copy), and the CLONE is digested, named and sent, so an object's name is the digest of bytes nothing else
 * can touch. A frozen copy is kept under its own digest (`snapshot/blobs/<sha256>`, `snapshot/large/<sha256>`), so
 * `files.json` alone says where each source is.
 *
 * ## The snapshot stays until every destination holds the staging
 *
 * An SSD unplugged tonight is sent this staging later by `--sweep-only`, and that sweep needs the blobs as they
 * were frozen — the live files may have changed since. So the snapshot is released only once every destination the
 * staging owes holds its receipt (`./stagingDestinations.ts`). The cost is stated rather than hidden: while a drive
 * is out, each night's staging keeps its frozen copies. A staging from before this split has no snapshot, and its
 * sweep names the objects it could not put back (`./filesHeld.ts`).
 *
 * ## One listing, and a retry on every blob write
 *
 * The skip test LISTS the blob prefix once and diffs locally (`blobsHeld`, `./plan.ts`) instead of asking about
 * each file — measured, the roots held ~4,700 files before `atlas` joined them, at two round trips a
 * file. And every blob upload goes through `uploadRetried` (`./transport.ts`): a blob write is idempotent from this
 * side — the name IS the digest of the bytes, so writing it again writes the same object.
 *
 * ## A large file is chunks, not a blob
 *
 * A file at or over `CHUNKED_FILE_MIN_BYTES` goes through `./largeFiles.ts` instead: frozen, cut by content
 * into chunks, and sent as the chunks the destination lacks. Its `files.json` entry carries the chunk list; every
 * other entry carries `chunked: null` and a blob, exactly as before.
 */
import { join } from "node:path";

import { writeJsonFile } from "#lib/jsonFile.js";

import type { ChunkTally } from "./chunkPlan.js";
import {
  BACKED_UP_FILE_ROOTS,
  BACKUP_MANIFEST_VERSION,
  type BackedUpFile,
  FILES_MANIFEST,
  type FilesManifest,
  type ManifestFile,
} from "./plan.js";

/** Where a staging's files are frozen before they are hashed, under its directory. */
const SNAPSHOT_DIRECTORY = "snapshot";

/** What the files leg did for one destination. */
export interface FilesLegReport {
  readonly count: number;
  readonly bytes: number;
  /** How many blobs were sent to this destination; the rest it already held. */
  readonly uploaded: number;
  readonly uploadedBytes: number;
  /** What the large files' chunks cost — how many this destination held, and what was sent. */
  readonly chunks: ChunkTally;
  /** Files the walk listed that were gone before they could be digested or frozen, left out of `files.json`. */
  readonly vanished: number;
}

/**
 * A staging's snapshot directory.
 *
 * @param directory the staging directory
 * @returns where its files are frozen
 */
export function snapshotDirectory({ directory }: { directory: string }): string {
  return join(directory, SNAPSHOT_DIRECTORY);
}

/**
 * Where a frozen small file is kept: under its own digest, so two files with the same bytes share one copy.
 *
 * @param snapshot the staging's snapshot directory
 * @param sha256 the frozen copy's digest
 * @returns the path
 */
export function frozenBlobPath({ snapshot, sha256 }: { snapshot: string; sha256: string }): string {
  return join(snapshot, "blobs", sha256);
}

/**
 * Where a frozen large file is kept, under its whole-file digest.
 *
 * @param snapshot the staging's snapshot directory
 * @param sha256 the frozen copy's whole-file digest
 * @returns the path
 */
export function frozenLargePath({ snapshot, sha256 }: { snapshot: string; sha256: string }): string {
  return join(snapshot, "large", sha256);
}

/**
 * Write `files.json` for one night.
 *
 * @param directory the staging directory
 * @param files the entries it names
 * @param nowIso the backup's instant
 */
export function writeFilesManifest({
  directory,
  files,
  nowIso,
}: {
  directory: string;
  files: readonly ManifestFile[];
  nowIso: string;
}): void {
  const manifest: FilesManifest = {
    createdAtIso: nowIso,
    files,
    roots: [...BACKED_UP_FILE_ROOTS],
    version: BACKUP_MANIFEST_VERSION,
  };
  writeJsonFile({ path: join(directory, FILES_MANIFEST), value: manifest });
}

/**
 * The leg's report for one destination, over the entries `files.json` names. Pure.
 *
 * @param files the entries
 * @param uploaded how many blobs were sent
 * @param uploadedBytes how many bytes those blobs carried
 * @param chunks what the large files' chunks cost
 * @param vanished how many listed files were gone before they could be digested or frozen
 * @returns the count and summed length of the entries, beside what was sent and what vanished
 */
export function legReport({
  files,
  uploaded,
  uploadedBytes,
  chunks,
  vanished,
}: {
  files: readonly BackedUpFile[];
  uploaded: number;
  uploadedBytes: number;
  chunks: ChunkTally;
  vanished: number;
}): FilesLegReport {
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return { bytes, chunks, count: files.length, uploaded, uploadedBytes, vanished };
}
