/**
 * The once-per-destination half of the files leg: list what one destination holds, and send it the blobs and
 * chunks it lacks from the staging's frozen copies. It only lists, diffs and uploads — `files.json` and the
 * snapshot are `./filesPrepare.ts`'s, and are exactly as they were when this returns (`./filesLeg.ts`).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ChunkedContent } from "./chunkPlan.js";
import { type FilesLegReport, legReport, snapshotDirectory } from "./filesLeg.js";
import { sendLargeFiles } from "./largeFiles.js";
import type { ManifestFile } from "./plan.js";
import { sendSmallFiles } from "./smallFiles.js";
import type { BackupTransport } from "./transport.js";

/**
 * How a failed blob upload is retried: three more attempts on the shipped backoff (`resolvedRetryOptions`),
 * and EVERY failure retried, because the write is idempotent (`./filesLeg.ts`) and a permanent one costs only
 * the backoff before it is reported exactly as before.
 */
const BLOB_UPLOAD_RETRY: RetryPolicy = { isRetryable: () => true, retries: 3 };

/** Where a large file's chunks are encoded before each is sent, under the staging directory. */
const CHUNK_SCRATCH_DIRECTORY = "files-chunk-scratch";

/** What sending one destination the night's files did. */
export interface FilesSent {
  readonly report: FilesLegReport;
  /**
   * Entries this destination lacks whose frozen copy is not in the snapshot. Always empty on the night that
   * prepared them; a sweep of a staging from before the split reports these rather than failing.
   */
  readonly unsourced: readonly string[];
}

/**
 * Send one destination the blobs and chunks `files.json` names that it lacks.
 *
 * @param directory the staging directory holding the snapshot
 * @param entries the entries `files.json` names
 * @param vanished how many files the walk listed and could not freeze, for the report
 * @param transport the destination
 * @param retry how a failed blob upload is retried; a test passes a zero backoff
 * @returns what was sent and which entries had no frozen copy, or the first upload that did not land
 */
export async function sendPreparedFiles({
  directory,
  entries,
  vanished,
  transport,
  retry = BLOB_UPLOAD_RETRY,
}: {
  directory: string;
  entries: readonly ManifestFile[];
  vanished: number;
  transport: BackupTransport;
  retry?: RetryPolicy;
}): Promise<Result<FilesSent>> {
  const snapshot = snapshotDirectory({ directory });
  const small = await sendSmallFiles({
    entries: entries.filter((entry) => entry.chunked === null),
    retry,
    snapshot,
    transport,
  });
  if (small.isErr()) {
    return err(small.error);
  }
  const scratch = join(directory, CHUNK_SCRATCH_DIRECTORY);
  mkdirSync(scratch, { mode: 0o700, recursive: true });
  try {
    const large = await sendLargeFiles({ entries: chunkedEntries({ entries }), retry, scratch, snapshot, transport });
    if (large.isErr()) {
      return err(large.error);
    }
    return ok({
      report: legReport({
        chunks: large.value.tally,
        files: entries,
        uploaded: small.value.uploaded,
        uploadedBytes: small.value.uploadedBytes,
        vanished,
      }),
      unsourced: [...small.value.unsourced, ...large.value.unsourced],
    });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * The entries stored as chunks. Pure.
 *
 * @param entries every entry `files.json` names
 * @returns those carrying a chunk list
 */
function chunkedEntries({
  entries,
}: {
  entries: readonly ManifestFile[];
}): readonly (ManifestFile & { readonly chunked: ChunkedContent })[] {
  return entries.filter(
    (entry): entry is ManifestFile & { readonly chunked: ChunkedContent } => entry.chunked !== null,
  );
}
