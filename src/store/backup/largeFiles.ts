/**
 * The files leg's large files: each frozen, cut into chunks, and sent as whatever chunks the destination lacks.
 *
 * A file at or over `CHUNKED_FILE_MIN_BYTES` (`./chunkPlan.ts`) is never one blob. Sent whole, a bronze `compact.jsonl`
 * that grew by a night's messages re-sent every byte it already had under a new digest — MEASURED, the Slack one alone was 17.4 GB, against a nightly budget of about 1.07 GB on this uplink
 * (`ls -l "$SLOPWEAVER_HOME/corpus/bronze/slack/compact.jsonl"`). Cut by content, a night that
 * appends sends the chunks past the old tail and a few either side of an edit.
 *
 * Every large file is frozen and planned BEFORE anything is sent, so `files.json` names each one by the
 * chunks of its frozen clone before a chunk of it can land at any destination. The clone is free on APFS
 * (`COPYFILE_FICLONE`), which is why every large file is frozen rather than only the ones that changed: the chunk
 * list, not the walk, decides what is missing. The clone is kept under its whole-file digest and outlives a send,
 * because a destination that was unplugged tonight is sent it later (`./filesLeg.ts`).
 */
import { constants, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import { addTallies, type ChunkedContent, type ChunkTally, missingChunks, NO_CHUNKS } from "./chunkPlan.js";
import { planFileChunks } from "./chunks.js";
import { chunkInventory, sendContentChunks } from "./chunkUpload.js";
import { fileVanished } from "./fileRace.js";
import { backedUpFilePath } from "./files.js";
import { frozenLargePath } from "./filesLeg.js";
import { type BackedUpFile, type ManifestFile, SUPABASE_PROJECT_ID } from "./plan.js";
import type { BackupTransport } from "./transport.js";
import { BackupUploadErrors } from "./uploadErrors.js";

/** One large file, frozen and cut: the entry `files.json` names, and the clone its chunks are read from. */
interface FrozenLargeFile {
  readonly entry: ManifestFile & { readonly chunked: ChunkedContent };
  readonly frozenPath: string;
}

/** The large files a freeze settled, and how many were gone before they could be cloned. */
export interface FrozenLargeFiles {
  readonly files: readonly FrozenLargeFile[];
  /** Large files removed between the walk and the clone — omitted, never failed (`./fileRace.ts`). */
  readonly vanished: number;
}

/**
 * Freeze every large file into the snapshot and cut the clone into its chunks.
 *
 * A file the walk measured and the clone found gone is counted and left out; any other clone failure
 * still stops the leg.
 *
 * @param home the Slopweaver home the files live under
 * @param files the large entries the walk measured
 * @param snapshot the staging's snapshot directory, its `large/` already made
 * @returns each file's entry as its clone measures it, beside the clone, and the vanished count; or the first
 *   that could not be frozen
 */
export function freezeLargeFiles({
  home,
  files,
  snapshot,
}: {
  home: string;
  files: readonly BackedUpFile[];
  snapshot: string;
}): Result<FrozenLargeFiles> {
  const frozen: FrozenLargeFile[] = [];
  let vanished = 0;
  for (const [index, walked] of files.entries()) {
    const incoming = join(snapshot, `incoming-large-${String(index)}`);
    const livePath = backedUpFilePath({ home, relativePath: walked.relativePath });
    try {
      copyFileSync(livePath, incoming, constants.COPYFILE_FICLONE);
    } catch (cause: unknown) {
      if (fileVanished({ cause, into: snapshot, path: livePath })) {
        vanished += 1;
        continue;
      }
      return err([BackupUploadErrors.blobUnfrozen({ cause, relativePath: walked.relativePath }).message]);
    }
    const planned = planFileChunks({ encoding: "zstd", path: incoming });
    if (planned.isErr()) {
      return err([planned.error.message]);
    }
    const { bytes, content, sha256 } = planned.value;
    const frozenPath = frozenLargePath({ sha256, snapshot });
    if (existsSync(frozenPath)) {
      rmSync(incoming, { force: true });
    } else {
      renameSync(incoming, frozenPath);
    }
    frozen.push({ entry: { bytes, chunked: content, relativePath: walked.relativePath, sha256 }, frozenPath });
  }
  return ok({ files: frozen, vanished });
}

/** What sending one destination its missing chunks did. */
export interface SentChunks {
  readonly tally: ChunkTally;
  /** Entries this destination lacks chunks of whose frozen copy is not in the snapshot. */
  readonly unsourced: readonly string[];
}

/**
 * Send one destination whatever chunks of the large files it lacks, from ONE listing of the chunk prefix, reading
 * each from its frozen copy — which is left in place for the next destination.
 *
 * @param entries the large entries `files.json` names, each with its chunk list
 * @param snapshot the staging's snapshot directory
 * @param scratch a directory encoded chunks may be staged in
 * @param retry how a failed chunk upload is retried
 * @param transport the destination
 * @returns what sending cost across every file and which had no frozen copy, or one line per failure
 */
export async function sendLargeFiles({
  entries,
  snapshot,
  scratch,
  retry,
  transport,
}: {
  entries: readonly (ManifestFile & { readonly chunked: ChunkedContent })[];
  snapshot: string;
  scratch: string;
  retry: RetryPolicy;
  transport: BackupTransport;
}): Promise<Result<SentChunks>> {
  if (entries.length === 0) {
    return ok({ tally: NO_CHUNKS, unsourced: [] });
  }
  const stored = await chunkInventory({ encoding: "zstd", project: SUPABASE_PROJECT_ID, transport });
  if (stored.isErr()) {
    return err(stored.error);
  }
  let tally = NO_CHUNKS;
  const unsourced: string[] = [];
  for (const entry of entries) {
    const frozenPath = frozenLargePath({ sha256: entry.sha256, snapshot });
    const lacking = missingChunks({ content: entry.chunked, project: SUPABASE_PROJECT_ID, stored: stored.value });
    if (lacking.length > 0 && !existsSync(frozenPath)) {
      unsourced.push(entry.relativePath);
      continue;
    }
    const sent = await sendContentChunks({
      content: entry.chunked,
      path: frozenPath,
      project: SUPABASE_PROJECT_ID,
      retry,
      scratch,
      stored: stored.value,
      transport,
    });
    if (sent.isErr()) {
      return err(sent.error);
    }
    tally = addTallies({ left: tally, right: sent.value });
  }
  return ok({ tally, unsourced });
}
