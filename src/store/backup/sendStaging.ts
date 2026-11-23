/**
 * One prepared staging sent to ONE destination: the key wrap, the night's file objects, the staged artefacts with
 * the manifest last, and that destination's receipt — in that order, which is the order `./run.ts`'s header gives
 * and the reason it is safe. A night with a list of destinations calls this once per destination, and a failure
 * here is that destination's alone: it returns lines, writes no receipt, and the next destination is still sent.
 */
import { errorMessage } from "#lib/errorMessage.js";
import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ChunkTally } from "./chunkPlan.js";
import type { ConfiguredDestination } from "./destinationConfig.js";
import { encryptingTransport } from "./encryptingTransport.js";
import { backupErrorLines } from "./errors.js";
import type { FilesLegReport } from "./filesLeg.js";
import type { PreparedFilesLeg } from "./filesPrepare.js";
import { sendPreparedFiles } from "./filesSend.js";
import { type KeyWrapStatus, keyWrapFor } from "./keyWrapStep.js";
import { type BackupManifest, backupPrefix, SUPABASE_PROJECT_ID } from "./plan.js";
import { type UploadReceipt, writeReceipt } from "./receipts.js";
import { BackupSendErrors } from "./sendErrors.js";
import { uploadStagedFiles } from "./staging.js";
import type { BackupTransport } from "./transport.js";

/** One night's staging, finished and frozen, before any destination is written. */
export interface PreparedBackup {
  readonly directory: string;
  readonly nowIso: string;
  readonly manifest: BackupManifest;
  readonly files: PreparedFilesLeg;
}

/** What sending the staging to one destination did. */
export interface DestinationSendReport {
  readonly keyWrap: KeyWrapStatus;
  readonly receipt: UploadReceipt;
  readonly files: FilesLegReport;
  /** What sending the dump's chunks cost at this destination. */
  readonly dumpChunks: ChunkTally;
}

/**
 * Send one prepared staging to one destination, and write that destination's receipt. A throw from the destination
 * becomes a returned failure, so one destination breaking its contract cannot stop the next one being sent.
 *
 * @param prepared the night's staging
 * @param destination which configured destination this is, for the receipt
 * @param transport the PLAIN destination, wrapped here in the object cipher
 * @param key the backup key every object is encrypted under
 * @param masterPassword the password the key is wrapped under, or `null` when none is set
 * @param uploadRetry how a failed upload session is retried, when not the default; a test passes a zero backoff
 * @returns what landed, or every reason this destination did not get the staging
 */
export async function sendPreparedBackup({
  prepared,
  destination,
  transport,
  key,
  masterPassword,
  uploadRetry,
}: {
  prepared: PreparedBackup;
  destination: ConfiguredDestination;
  transport: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
  uploadRetry?: RetryPolicy;
}): Promise<Result<DestinationSendReport>> {
  try {
    return await sendInOrder({
      destination,
      key,
      masterPassword,
      prepared,
      transport,
      ...(uploadRetry === undefined ? {} : { uploadRetry }),
    });
  } catch (cause: unknown) {
    return err([BackupSendErrors.threw({ root: destination.root, why: errorMessage({ error: cause }) }).message]);
  }
}

/**
 * {@link sendPreparedBackup}'s order: wrap, files, staged artefacts with the manifest last, receipt.
 *
 * @param prepared the night's staging
 * @param destination which configured destination this is
 * @param transport the plain destination
 * @param key the backup key
 * @param masterPassword the password, or `null`
 * @param uploadRetry how a failed upload session is retried
 * @returns what landed, or why it stopped
 */
async function sendInOrder({
  prepared,
  destination,
  transport,
  key,
  masterPassword,
  uploadRetry,
}: {
  prepared: PreparedBackup;
  destination: ConfiguredDestination;
  transport: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
  uploadRetry?: RetryPolicy;
}): Promise<Result<DestinationSendReport>> {
  const keyWrap = await keyWrapFor({ destination: transport, key, masterPassword });
  if (keyWrap.isErr()) {
    return err(backupErrorLines({ error: keyWrap.error }));
  }
  const sent = encryptingTransport({ inner: transport, key });
  const { directory, files, manifest, nowIso } = prepared;
  // The files leg FIRST — the ruling's order, and the reason is in `BACKED_UP_FILE_ROOTS`.
  const filesSent = await sendPreparedFiles({
    directory,
    entries: files.entries,
    transport: sent.transport,
    vanished: files.vanished,
    ...(uploadRetry === undefined ? {} : { retry: uploadRetry }),
  });
  if (filesSent.isErr()) {
    return err(filesSent.error);
  }
  if (filesSent.value.unsourced.length > 0) {
    return err([BackupSendErrors.frozenCopiesGone({ files: filesSent.value.unsourced }).message]);
  }
  const prefix = backupPrefix({ createdAtIso: nowIso, project: SUPABASE_PROJECT_ID });
  const uploaded = await uploadStagedFiles({
    directory,
    manifest,
    prefix,
    transport: sent.transport,
    ...(uploadRetry === undefined ? {} : { retry: uploadRetry }),
  });
  if (uploaded.isErr()) {
    return err(uploaded.error);
  }
  const receipt: UploadReceipt = {
    destination: destination.root,
    encryption: { keyFingerprint: sent.keyFingerprint, scheme: sent.scheme },
    objects: uploaded.value.objects,
    prefix,
    uploadedAtIso: new Date().toISOString(),
  };
  writeReceipt({ destination, directory, receipt });
  return ok({ dumpChunks: uploaded.value.dumpChunks, files: filesSent.value.report, keyWrap: keyWrap.value, receipt });
}
