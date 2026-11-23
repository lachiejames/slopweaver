/**
 * The sweep: every EARLIER staging one destination never got, sent to it now, so a night that staged and stopped —
 * or a night its drive was out — is not permanent.
 *
 * ## Why it exists
 *
 * `stagingToPrune` keeps a staging forever until every destination it owes holds it, on purpose — a local copy is
 * only let go of once each destination verifiably holds it. With nothing ever re-attempting the send, that made an
 * unsent night a permanent local hold AND a permanently missing backup: MEASURED on this install, 1.98 GB across
 * `2026-09-20T05-49-58-043Z` and `2026-09-20T14-24-14-429Z`. Recovering one also releases it to the pruner, so the
 * disk comes back as a consequence of the fix rather than as separate work.
 *
 * ## Five properties that are the design
 *
 * - **Per destination.** A staging is stranded FOR one destination (`staging.ts`'s `isStranded`): the SSD that was
 *   out lacks it while this Mac's folder already holds it, so the sweep sends it to the SSD and never again to the
 *   Mac. Each destination's receipt is its own (`./receipts.ts`).
 * - **Newest first**: MEASURED, four ~1 GB stagings were stranded on this install at once, and
 *   oldest-first would have spent the first hour sending the least useful of them.
 * - **The night's files come from its retained snapshot.** A staging keeps its frozen copies (`./filesLeg.ts`) until
 *   every destination it owes holds them, so a sweep sends the SSD exactly the bytes the night measured, by the
 *   names its `files.json` gave them, before the staged artefacts.
 * - **Nothing here can fail the run.** A stranded copy that will not go is a report line naming the directory and
 *   the reason, because the operator's real choice about one is to fix it or delete it. That holds against a THROW
 *   too: every recovery is caught and becomes one more report line.
 * - **Two runs sweeping the same directory at once is benign.** They send identical bytes to identical object names
 *   and the receipt write is atomic. It is wasteful, not wrong.
 *
 * ## What it cannot put back
 *
 * A staging from before the snapshot was retained has no frozen copies, and its `files.json` names content-addressed
 * blobs whose live paths may have changed since. Those are whatever the nights that DID send put there. Never a
 * silent limit: before its receipt, each recovered staging's `files.json` is checked against the destination
 * (`./filesHeld.ts`), and the report names how many of its objects are missing.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { readJsonFile } from "#lib/jsonFile.js";
import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import type { ConfiguredDestination } from "./destinationConfig.js";
import { type BackupError, BackupErrors, backupErrorLines } from "./errors.js";
import { stagedFilesMissing } from "./filesHeld.js";
import { snapshotDirectory } from "./filesLeg.js";
import { sendPreparedFiles } from "./filesSend.js";
import {
  BACKUP_FILES,
  backupDirectoryName,
  backupPrefix,
  FILES_MANIFEST,
  parseBackupManifest,
  parseFilesManifest,
  SUPABASE_PROJECT_ID,
} from "./plan.js";
import { type ReceiptEncryption, type UploadReceipt, writeReceipt } from "./receipts.js";
import { isStranded, isUnfinished, stagedDirectoryNames, uploadStagedFiles } from "./staging.js";
import { type StagingSweepError, StagingSweepErrors } from "./sweepErrors.js";
import type { BackupTransport, StoredObject } from "./transport.js";

/** One earlier staging the sweep got into the destination. */
interface RecoveredStaging {
  readonly directory: string;
  readonly prefix: string;
  readonly objects: readonly StoredObject[];
  /** Blobs and chunks its `files.json` names that the destination lacks: its files half will not restore without them. */
  readonly filesMissing: readonly string[];
}

/** One earlier staging the sweep could not get into the destination, and why. */
interface UnrecoverableStaging {
  readonly directory: string;
  /** The typed failure, so a caller can branch on `code` and display `message` without reassembling either. */
  readonly error: StagingSweepError;
}

/** What the sweep of earlier stagings found and did, at one destination. */
export interface SweepReport {
  readonly recovered: readonly RecoveredStaging[];
  readonly unrecoverable: readonly UnrecoverableStaging[];
  /** Stagings carrying no `files.json` — a run in flight, or one that died before finishing. Not strandable. */
  readonly unfinished: readonly string[];
}

/** What every recovery at one destination is sent through and recorded as. */
interface SweepTarget {
  /** The encrypting destination. */
  readonly transport: BackupTransport;
  /** Which configured destination this is, for its receipts. */
  readonly destination: ConfiguredDestination;
  /** How the transport encrypts, for each receipt written. */
  readonly encryption: ReceiptEncryption;
  readonly uploadRetry?: RetryPolicy;
}

/**
 * Send every earlier staging this destination never got, and report every one that will not go.
 *
 * @param root the staging root
 * @param transport the encrypting destination
 * @param destination which configured destination this is, for selection and for each receipt
 * @param encryption how the transport encrypts, for each receipt written
 * @param uploadRetry how a failed upload session is retried, when not the staged default; a test passes a zero backoff
 * @returns what was recovered, what could not be, and what is not finished
 */
export async function sweepStrandedStagings({ root, ...target }: { root: string } & SweepTarget): Promise<SweepReport> {
  const recovered: RecoveredStaging[] = [];
  const unrecoverable: UnrecoverableStaging[] = [];
  const unfinished: string[] = [];
  // NEWEST first: the most recent dump is the most valuable one, so a sweep interrupted part-way through a
  // backlog of 1 GB uploads has already sent the copy worth having.
  for (const name of stagedDirectoryNames({ root }).toReversed()) {
    const directory = join(root, name);
    if (isUnfinished({ directory })) {
      unfinished.push(directory);
      continue;
    }
    if (!isStranded({ destination: target.destination, directory })) {
      continue;
    }
    const outcome = await safeRecoverStaging({ directory, ...target });
    if (outcome.isErr()) {
      unrecoverable.push({ directory, error: outcome.error });
      continue;
    }
    recovered.push(outcome.value);
  }
  return { recovered, unfinished, unrecoverable };
}

/**
 * {@link recoverStaging}, with a throw turned into the same typed refusal a returned failure gets.
 *
 * @param directory the staging directory
 * @returns what landed, or why this staging is not recoverable
 */
async function safeRecoverStaging(
  target: { directory: string } & SweepTarget,
): Promise<Result<RecoveredStaging, StagingSweepError>> {
  try {
    return await recoverStaging(target);
  } catch (cause) {
    return err(StagingSweepErrors.recoveryThrew({ cause, directory: target.directory }));
  }
}

/**
 * Send one stranded staging's retained files and its own objects, and leave this destination's receipt behind.
 *
 * @param directory the staging directory
 * @returns what landed, or why this staging is not recoverable
 */
async function recoverStaging({
  directory,
  transport,
  destination,
  encryption,
  uploadRetry,
}: { directory: string } & SweepTarget): Promise<Result<RecoveredStaging, StagingSweepError>> {
  const staged = readStagedManifest({ path: join(directory, BACKUP_FILES.manifest) }).andThen(({ sha256, value }) =>
    parseBackupManifest({ value }).map((manifest) => ({ manifest, sha256 })),
  );
  if (staged.isErr()) {
    return err(
      StagingSweepErrors.unreadableManifest({ directory, problems: backupErrorLines({ error: staged.error }) }),
    );
  }
  const { manifest, sha256 } = staged.value;
  const prefix = backupPrefix({ createdAtIso: manifest.createdAtIso, project: manifest.project });
  const ownName = backupDirectoryName({ createdAtIso: manifest.createdAtIso }) === basename(directory);
  if (!ownName || manifest.project !== SUPABASE_PROJECT_ID) {
    return err(StagingSweepErrors.misnamed({ directory, prefix }));
  }
  const retryOption = uploadRetry === undefined ? {} : { retry: uploadRetry };
  const files = await sendRetainedFiles({ directory, transport, ...retryOption });
  if (files.isErr()) {
    return err(StagingSweepErrors.uploadFailed({ directory, problems: files.error }));
  }
  const uploaded = await uploadStagedFiles({
    directory,
    manifest,
    manifestSha256: sha256,
    prefix,
    transport,
    ...retryOption,
  });
  if (uploaded.isErr()) {
    return err(StagingSweepErrors.uploadFailed({ directory, problems: uploaded.error }));
  }
  // Before the receipt: once it is written the pruner may let this staging go, so a files half that will
  // not restore has to be said now or never.
  const filesMissing = await sentFilesMissing({ directory, objects: uploaded.value.objects, prefix, transport });
  if (filesMissing.isErr()) {
    return err(filesMissing.error);
  }
  const receipt: UploadReceipt = {
    destination: destination.root,
    encryption,
    objects: uploaded.value.objects,
    prefix,
    uploadedAtIso: new Date().toISOString(),
  };
  writeReceipt({ destination, directory, receipt });
  return ok({ directory, filesMissing: filesMissing.value, objects: uploaded.value.objects, prefix });
}

/**
 * Send the destination what the staging's `files.json` names and it lacks, from the retained snapshot. A staging
 * with no snapshot, or a `files.json` that will not parse, sends nothing here — `sentFilesMissing` then says what
 * is missing, or why it could not check, so neither is silent.
 *
 * @param directory the staging directory
 * @param transport the encrypting destination
 * @param retry how a failed blob upload is retried, when not the default
 * @returns nothing, or the first upload that did not land
 */
async function sendRetainedFiles({
  directory,
  transport,
  retry,
}: {
  directory: string;
  transport: BackupTransport;
  retry?: RetryPolicy;
}): Promise<Result<void>> {
  if (!existsSync(snapshotDirectory({ directory }))) {
    return ok(undefined);
  }
  const files = parseFilesManifest({ value: readJsonFile({ path: join(directory, FILES_MANIFEST) }) });
  if (files.isErr()) {
    return ok(undefined);
  }
  const sent = await sendPreparedFiles({
    directory,
    entries: files.value.files,
    transport,
    vanished: 0,
    ...(retry === undefined ? {} : { retry }),
  });
  return sent.map(() => undefined);
}

/**
 * Which objects the `files.json` a staging just sent names that the destination lacks — checked against the SAME
 * bytes that were sent, so a `files.json` rewritten on disk in between is refused rather than vouched for.
 *
 * @param objects what the staging's upload reports landed
 * @param prefix the staging's object prefix, which its `files.json` was sent under
 * @param transport the destination
 * @returns the missing object names, or why the check could not vouch for what was sent
 */
async function sentFilesMissing({
  directory,
  objects,
  prefix,
  transport,
}: {
  directory: string;
  objects: readonly StoredObject[];
  prefix: string;
  transport: BackupTransport;
}): Promise<Result<readonly string[], StagingSweepError>> {
  const checked = await stagedFilesMissing({ directory, transport });
  if (checked.isErr()) {
    return err(StagingSweepErrors.filesUnchecked({ directory, problems: checked.error }));
  }
  const sent = objects.find((object) => object.name === `${prefix}${FILES_MANIFEST}`);
  if (sent?.sha256 !== checked.value.sha256) {
    return err(
      StagingSweepErrors.filesUnchecked({
        directory,
        problems: [
          `the ${FILES_MANIFEST} that was sent is not the one that was checked — it changed on disk in between`,
        ],
      }),
    );
  }
  return ok(checked.value.missing);
}

/**
 * Read a staged `manifest.json` ONCE, so the value the sweep checks the payloads against and the digest the
 * uploaded manifest must hash to come from the same bytes — a rewrite between the parse and the send is
 * refused rather than sent under a receipt.
 *
 * @param path the staged manifest
 * @returns the parsed value and the digest of the bytes it was parsed from, or why the file could not be read
 */
function readStagedManifest({ path }: { path: string }): Result<{ value: unknown; sha256: string }, BackupError> {
  try {
    const bytes = readFileSync(path);
    return ok({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      value: safeJsonParse({ label: path, text: bytes.toString("utf8") }),
    });
  } catch (cause: unknown) {
    return err(BackupErrors.stagedManifestUnreadable({ cause, path }));
  }
}
