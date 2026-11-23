/**
 * The files leg for ONE destination, as a test drives it: prepare once, then send to `transport` unless it is
 * `null`. The production path calls the two halves separately, once and once per destination
 * (`store/backup/filesLeg.ts`); this joins them so a test of either half reads as one call.
 */
import type { RetryPolicy } from "../../../lib/resilience.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { NO_CHUNKS } from "../../../store/backup/chunkPlan.js";
import { type FilesLegReport, legReport } from "../../../store/backup/filesLeg.js";
import { prepareFilesLeg } from "../../../store/backup/filesPrepare.js";
import { sendPreparedFiles } from "../../../store/backup/filesSend.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

/**
 * Prepare the night's files and send them to one destination.
 *
 * @param home the sandbox home
 * @param directory the staging directory
 * @param nowIso the backup's instant
 * @param transport the destination, or `null` to prepare and stop
 * @param deps the walk and digest effects
 * @param uploadRetry how a failed blob upload is retried
 * @returns the leg's report for that destination, or why it stopped
 */
export async function runFilesLeg({
  home,
  directory,
  nowIso,
  transport,
  deps,
  uploadRetry,
}: {
  home: string;
  directory: string;
  nowIso: string;
  transport: BackupTransport | null;
  deps: BackupDeps;
  uploadRetry?: RetryPolicy;
}): Promise<Result<FilesLegReport>> {
  const prepared = prepareFilesLeg({ deps, directory, home, nowIso, protection: NO_PROTECTION });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const { entries, vanished } = prepared.value;
  if (transport === null) {
    return ok(legReport({ chunks: NO_CHUNKS, files: entries, uploaded: 0, uploadedBytes: 0, vanished }));
  }
  const sent = await sendPreparedFiles({
    directory,
    entries,
    transport,
    vanished,
    ...(uploadRetry === undefined ? {} : { retry: uploadRetry }),
  });
  return sent.map((value) => value.report);
}
