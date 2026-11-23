/**
 * The staging root as a STORE: what one backup leaves in `$SLOPWEAVER_HOME/backups/store/<instant>/`, how
 * a finished staging is sent under its prefix, which stagings one destination still lacks, and what the pruner
 * may then let go of. The per-destination receipts themselves are `./receipts.ts`, and what each staging owes is
 * `./stagingDestinations.ts`.
 *
 * Its own module beside `./run.ts` because two callers need all of it and neither owns it: {@link
 * runBackup} sends tonight's staging, and `./sweep.ts` sends every earlier one the destination never got. Before
 * the sweep existed there was one caller and this lived inline.
 *
 * **The completeness marker is `files.json`, not `manifest.json`.** `runBackup` writes the dump manifest in
 * its staging step and the files manifest after it, so `files.json` is the last file a staging gains before
 * it is uploaded. Anything selecting "finished stagings" has to test for that one, and moving either write
 * would break the sweep silently.
 *
 * **A chunked dump is sent as its chunks, not as one object.** A version-2 manifest records the dump's chunk
 * list (`./chunkPlan.ts`), and every chunk the destination lacks is sent under `chunks/identity/` in place of
 * `store.dump` — the night's dump is ~98.6% the same bytes as the last one, so a night sends the rest. A
 * version-1 staging the sweep finds still sends its dump whole, exactly as it was written to be.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";

import { type ChunkedContent, type ChunkTally, NO_CHUNKS } from "./chunkPlan.js";
import { chunkInventory, sendContentChunks } from "./chunkUpload.js";
import type { ConfiguredDestination, DestinationId } from "./destinationConfig.js";
import { backupErrorLines } from "./errors.js";
import { BACKUP_FILES, type BackupManifest, FILES_MANIFEST, SUPABASE_PROJECT_ID, stagingToPrune } from "./plan.js";
import { readReceipt } from "./receipts.js";
import { stagingOwes, stagingUploadedToAll } from "./stagingDestinations.js";
import { type BackupTransport, type StoredObject, uploadRetried } from "./transport.js";
import { type BackupUploadError, BackupUploadErrors } from "./uploadErrors.js";

/**
 * How a staged file whose upload session failed is retried: two more attempts, each a NEW session sending from
 * the first byte. It is kept small because each attempt resends a whole file.
 */
const STAGED_UPLOAD_RETRY: RetryPolicy = { isRetryable: () => true, retries: 2 };

/** Where a staging's dump chunks are encoded before each is sent, under the staging directory. */
const CHUNK_SCRATCH_DIRECTORY = "chunk-scratch";

/** What sending one staging landed: its own objects, and what its dump's chunks cost. */
export interface StagedUpload {
  readonly objects: readonly StoredObject[];
  /** The dump's chunks, or {@link NO_CHUNKS} for a dump sent as one object. */
  readonly dumpChunks: ChunkTally;
}

/**
 * Where one install stages its backups.
 *
 * @param home the Slopweaver home
 * @returns the staging root
 */
export function stagingRoot({ home }: { home: string }): string {
  return stateHomePaths({ home }).storeBackups;
}

/**
 * Every staging directory name under the root, whatever state each is in.
 *
 * @param root the staging root
 * @returns the directory names, oldest first — the names are instants, so lexical order IS chronological
 */
export function stagedDirectoryNames({ root }: { root: string }): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/**
 * Whether a staging directory is finished, owed to one destination, and not yet in it — the sweep's whole
 * criterion. One staging can be stranded for the SSD and complete for this Mac.
 *
 * @param directory the staging directory
 * @param destination the destination being swept
 * @returns true when it carries `files.json`, owes this destination, and holds no receipt that counts for it
 */
export function isStranded({
  directory,
  destination,
}: {
  directory: string;
  destination: ConfiguredDestination;
}): boolean {
  if (isUnfinished({ directory }) || !stagingOwes({ directory, id: destination.id })) {
    return false;
  }
  return readReceipt({ directory, id: destination.id }) === null;
}

/**
 * Whether a staging directory has not finished being written — no `files.json`, whatever receipts it holds.
 *
 * A run in flight is in exactly this state, and so is one that died before the files leg, so neither is
 * something any caller may send. A receipt without the completeness marker is corrupt evidence, not a finished
 * staging.
 *
 * @param directory the staging directory
 * @returns true when it is not finished
 */
export function isUnfinished({ directory }: { directory: string }): boolean {
  return !existsSync(join(directory, FILES_MANIFEST));
}

/**
 * Send one finished staging's own objects, manifest last, checking each landed whole.
 *
 * The files manifest rides under the same prefix so one listing names everything a restore needs, and the
 * dump manifest goes last for the reason `./run.ts`'s header gives: a prefix carrying it is a finished one.
 * A chunked dump's chunks go before it for the same reason.
 *
 * @param directory the staging directory holding them
 * @param prefix the object prefix they land under
 * @param manifest the dump manifest, whose sizes and digests the landed objects are checked against
 * @param manifestSha256 the digest of the bytes `manifest` was parsed from, when the caller read them itself: the
 *   uploaded manifest must hash to it, so a rewrite after the parse is refused rather than sent
 * @param transport the destination
 * @param retry how a failed upload session is retried; a test passes a zero backoff
 * @returns what landed, or the first upload that did not carry its whole file
 */
export async function uploadStagedFiles({
  directory,
  prefix,
  manifest,
  manifestSha256,
  transport,
  retry = STAGED_UPLOAD_RETRY,
}: {
  directory: string;
  prefix: string;
  manifest: BackupManifest;
  manifestSha256?: string;
  transport: BackupTransport;
  retry?: RetryPolicy;
}): Promise<Result<StagedUpload>> {
  const objects: StoredObject[] = [];
  const chunked = manifest.dump.chunked;
  let dumpChunks = NO_CHUNKS;
  if (chunked !== null) {
    const sent = await sendDumpChunks({ content: chunked, directory, retry, transport });
    if (sent.isErr()) {
      return err(sent.error);
    }
    dumpChunks = sent.value;
  }
  const wanted: readonly { expected: { bytes: number | null; sha256: string } | null; name: string }[] = [
    { expected: null, name: FILES_MANIFEST },
    ...(chunked === null ? [{ expected: manifest.dump, name: BACKUP_FILES.dump }] : []),
    { expected: manifest.storage, name: BACKUP_FILES.storage },
    ...(manifest.secrets === null ? [] : [{ expected: manifest.secrets, name: BACKUP_FILES.secrets }]),
    ...(manifest.vault === null ? [] : [{ expected: manifest.vault, name: BACKUP_FILES.vault }]),
    {
      expected: manifestSha256 === undefined ? null : { bytes: null, sha256: manifestSha256 },
      name: BACKUP_FILES.manifest,
    },
  ];
  for (const file of wanted) {
    const uploaded = await uploadRetried({
      objectName: `${prefix}${file.name}`,
      path: join(directory, file.name),
      retry,
      transport,
    });
    if (uploaded.isErr()) {
      return err(backupErrorLines({ error: uploaded.error }));
    }
    const problem = stagedLandingProblem({
      expected: file.expected,
      objectName: `${prefix}${file.name}`,
      uploaded: uploaded.value,
    });
    if (problem !== null) {
      return err([problem.message]);
    }
    objects.push(uploaded.value);
  }
  return ok({ dumpChunks, objects });
}

/**
 * Send whatever chunks of one staged dump the destination lacks, straight from the staged file — which nothing
 * else writes, so it needs no freezing.
 *
 * @param directory the staging directory holding the dump
 * @param content the dump's chunk list, from its manifest
 * @param retry how a failed chunk upload is retried
 * @param transport the destination
 * @returns what sending cost, or one line per failure
 */
async function sendDumpChunks({
  directory,
  content,
  retry,
  transport,
}: {
  directory: string;
  content: ChunkedContent;
  retry: RetryPolicy;
  transport: BackupTransport;
}): Promise<Result<ChunkTally>> {
  const stored = await chunkInventory({ encoding: content.encoding, project: SUPABASE_PROJECT_ID, transport });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const scratch = join(directory, CHUNK_SCRATCH_DIRECTORY);
  mkdirSync(scratch, { mode: 0o700, recursive: true });
  try {
    return await sendContentChunks({
      content,
      path: join(directory, BACKUP_FILES.dump),
      project: SUPABASE_PROJECT_ID,
      retry,
      scratch,
      stored: stored.value,
      transport,
    });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * Whether one staged upload landed as asked: at the object name it was sent to and, where the manifest
 * recorded them, at the length and digest recorded. Pure.
 *
 * @param uploaded what the transport reported landing
 * @param objectName the object it was asked to write
 * @param expected the length and digest the manifest recorded, `bytes: null` where only a digest is known, or
 *   `null` for a file the manifest does not describe
 * @returns the first way it did not land as asked, or `null` when it did
 */
function stagedLandingProblem({
  uploaded,
  objectName,
  expected,
}: {
  uploaded: StoredObject;
  objectName: string;
  expected: { bytes: number | null; sha256: string } | null;
}): BackupUploadError | null {
  if (uploaded.name !== objectName) {
    return BackupUploadErrors.stagedFileMisplaced({ landed: uploaded.name, objectName });
  }
  if (expected === null) {
    return null;
  }
  if (expected.bytes !== null && uploaded.bytes !== expected.bytes) {
    return BackupUploadErrors.stagedFileShort({ expected: expected.bytes, held: uploaded.bytes, objectName });
  }
  if (uploaded.sha256 !== expected.sha256) {
    return BackupUploadErrors.stagedFileAltered({ objectName, recorded: expected.sha256, sent: uploaded.sha256 });
  }
  return null;
}

/**
 * Every staging directory under one install's root, oldest first, as full paths — empty when nothing was ever
 * staged.
 *
 * @param home the Slopweaver home
 * @returns the staging directories
 */
export function stagingDirectories({ home }: { home: string }): readonly string[] {
  const root = stagingRoot({ home });
  if (!existsSync(root)) {
    return [];
  }
  return stagedDirectoryNames({ root }).map((name) => join(root, name));
}

/**
 * Make the staging root, so a caller that is about to write into it does not have to.
 *
 * @param home the Slopweaver home
 * @returns the staging root
 */
export function ensureStagingRoot({ home }: { home: string }): string {
  const root = stagingRoot({ home });
  mkdirSync(root, { mode: 0o700, recursive: true });
  return root;
}

/**
 * The staged copies every destination they owe already holds, past the newest `keep` — what a prune removes.
 *
 * A copy is let go of only when each destination it still owes has a receipt that PARSES and names it — a
 * missing, truncated or mismatched receipt keeps it, and so does one owed to an unplugged drive.
 *
 * @param root the staging root
 * @param keep how many eligible copies to keep
 * @param obligations the destination ids still configured, from `./stagingDestinations.ts`'s `pruneObligations`
 * @returns the directory names a prune would remove
 */
export function prunableStagings({
  root,
  keep,
  obligations,
}: {
  root: string;
  keep: number;
  obligations: readonly DestinationId[];
}): readonly string[] {
  const staged = stagedDirectoryNames({ root }).map((name) => ({
    eligible: stagingUploadedToAll({ directory: join(root, name), obligations }),
    name,
  }));
  return stagingToPrune({ keep, staged });
}

/**
 * Remove one staging directory whole. Throws when the filesystem refuses, so a caller decides what that means.
 *
 * @param directory the staging directory to remove
 */
export function removeStaging({ directory }: { directory: string }): void {
  rmSync(directory, { force: true, recursive: true });
}

/**
 * Remove staged copies every destination they owe already holds, keeping the newest (`prunableStagings`).
 *
 * @param root the staging root
 * @param keep how many eligible copies to keep
 * @param obligations the destination ids still configured, from `./stagingDestinations.ts`'s `pruneObligations`
 * @returns the directory names removed
 */
export function pruneStaging({
  root,
  keep,
  obligations,
}: {
  root: string;
  keep: number;
  obligations: readonly DestinationId[];
}): readonly string[] {
  const doomed = prunableStagings({ keep, obligations, root });
  doomed.forEach((name) => {
    removeStaging({ directory: join(root, name) });
  });
  return doomed;
}
