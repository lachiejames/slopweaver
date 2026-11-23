/**
 * The once-a-night half of the files leg: walk once, freeze every file once, and write the final `files.json`
 * before any destination is written. Why it is split from the send, and why the snapshot outlives it, is
 * `./filesLeg.ts`'s header.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { CHUNKED_FILE_MIN_BYTES } from "./chunkPlan.js";
import { backupErrorLines } from "./errors.js";
import { snapshotDirectory, writeFilesManifest } from "./filesLeg.js";
import { freezeLargeFiles } from "./largeFiles.js";
import type { BackedUpFile, ManifestFile } from "./plan.js";
import type { BackupProtection, SkippedProtectedPath } from "./protectedPaths.js";
import type { BackupDeps } from "./run.js";
import { freezeSmallFiles } from "./smallFiles.js";

/** One night's files, frozen: what `files.json` names, and what the walk could not freeze. */
export interface PreparedFilesLeg {
  /** Every entry `files.json` names, in path order, each by the digest of its frozen copy. */
  readonly entries: readonly ManifestFile[];
  /** Files the walk listed that were gone before they could be digested or frozen. */
  readonly vanished: number;
  /** Every protected path the walk pruned, with the owner's reason — in no manifest, since none of it is restorable. */
  readonly skippedProtectedPaths: readonly SkippedProtectedPath[];
}

/**
 * Walk the backed-up roots, freeze every file into the staging's snapshot, and write the final `files.json`.
 *
 * `files.json` is written TWICE, both before any destination is touched: once from the walk, so a freeze that
 * fails still leaves the staging finished and the night's dump for the sweep, and once from the frozen digests,
 * which is the manifest every destination receives. Nothing after this function rewrites it.
 *
 * @param home the Slopweaver home the roots live under
 * @param directory the staging directory the manifest and the snapshot are written into
 * @param nowIso the backup's instant
 * @param protection the owner's protected paths, which the walk prunes before it lists them
 * @param deps the walk and digest effects
 * @returns the frozen entries, or the first file that could not be read or frozen — the snapshot removed with it
 */
export function prepareFilesLeg({
  home,
  directory,
  nowIso,
  protection,
  deps,
}: {
  home: string;
  directory: string;
  nowIso: string;
  protection: BackupProtection;
  deps: BackupDeps;
}): Result<PreparedFilesLeg> {
  const walked = deps.walkBackedUpFiles({ home, protection });
  if (walked.isErr()) {
    return err(backupErrorLines({ error: walked.error }));
  }
  const { files, vanished, skippedProtectedPaths } = walked.value;
  writeFilesManifest({ directory, files: files.map((file) => ({ ...file, chunked: null })), nowIso });
  const snapshot = snapshotDirectory({ directory });
  const frozen = freezeAll({ deps, files, home, snapshot });
  if (frozen.isErr()) {
    rmSync(snapshot, { force: true, recursive: true });
    return err(frozen.error);
  }
  writeFilesManifest({ directory, files: frozen.value.entries, nowIso });
  return ok({ entries: frozen.value.entries, skippedProtectedPaths, vanished: vanished + frozen.value.vanished });
}

/**
 * Remove a staging's frozen copies — once every destination it owes holds it, or when it is pruned.
 *
 * @param directory the staging directory
 */
export function releasePreparedFiles({ directory }: { directory: string }): void {
  rmSync(snapshotDirectory({ directory }), { force: true, recursive: true });
}

/**
 * Freeze the small files and the large ones, and name every survivor in path order. Writes no `files.json`.
 *
 * @param files every entry the walk measured
 * @param home the Slopweaver home
 * @param snapshot the staging's snapshot directory
 * @param deps the digest effect
 * @returns every surviving entry by its frozen digest, and how many vanished; or the first freeze failure
 */
function freezeAll({
  files,
  home,
  snapshot,
  deps,
}: {
  files: readonly BackedUpFile[];
  home: string;
  snapshot: string;
  deps: BackupDeps;
}): Result<{ entries: readonly ManifestFile[]; vanished: number }> {
  mkdirSync(join(snapshot, "blobs"), { mode: 0o700, recursive: true });
  mkdirSync(join(snapshot, "large"), { mode: 0o700, recursive: true });
  const small = freezeSmallFiles({
    digest: deps.digestFile,
    files: files.filter((file) => file.bytes < CHUNKED_FILE_MIN_BYTES),
    home,
    snapshot,
  });
  if (small.isErr()) {
    return err(small.error);
  }
  const large = freezeLargeFiles({
    files: files.filter((file) => file.bytes >= CHUNKED_FILE_MIN_BYTES),
    home,
    snapshot,
  });
  if (large.isErr()) {
    return err(large.error);
  }
  const entries: ManifestFile[] = [
    ...small.value.entries.map((file) => ({ ...file, chunked: null })),
    ...large.value.files.map((file) => file.entry),
  ];
  return ok({
    entries: entries.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath)),
    vanished: small.value.vanished + large.value.vanished,
  });
}
