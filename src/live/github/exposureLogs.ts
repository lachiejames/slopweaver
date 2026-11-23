/**
 * The job-log half of `github exposure sweep`: every Actions job's log, streamed and scanned in batches, never held
 * whole. A log is public the moment the repository is, for as long as GitHub retains it.
 *
 * The stream is the run-log verb's own seam (`./jobLogRead.ts`'s {@link StreamJobLog}), so this reads a log the way
 * `github run-log` does and through the same door. Each batch keeps its place in the log as a line offset, so a
 * finding's line is the log's own line.
 *
 * The line splitter is this module's own, not the run-log reader's: that one keeps a tail window and caps a line at
 * 8,192 characters, which is right for showing a failure and wrong for a scan, where every character is the point.
 * Here a line is kept whole up to {@link EXPOSURE_LOG_LINE_CHARS}, and every line cut there — the last one, with no
 * newline after it, included — is a counted gap.
 *
 * A log GitHub no longer serves (retention expired, or never written) is a LIMIT, not a gap: nothing can read it and
 * nobody can see it once public. Every other failure is a gap, counted — never naming the job a finding may sit at.
 */

import type { GithubExposureText } from "./exposureTexts.js";
import { stripLogTimestamp } from "./jobLog.js";
import type { StreamJobLog } from "./jobLogRead.js";

/** How many lines one scanned batch holds at most. A token is one line, so a batch edge splits none. */
export const EXPOSURE_LOG_BATCH_LINES = 2000;

/** How many characters one scanned batch holds at most, so a log of long lines stays bounded too. */
const EXPOSURE_LOG_BATCH_CHARS = 4 * 1024 * 1024;

/** The longest line scanned whole. A longer one is scanned to here and counted as a gap. */
const EXPOSURE_LOG_LINE_CHARS = 1024 * 1024;

/** What the job-log stage read and could not read. */
export interface GithubExposureLogsReading {
  readonly calls: number;
  readonly gaps: readonly string[];
  readonly limits: readonly string[];
}

/** A splitter of streamed chunks into whole lines, each capped, counting every line it cut. */
interface GithubExposureLogSplitter {
  /** The lines this chunk completed. */
  readonly push: (args: { chunk: string }) => readonly string[];
  /** The last line, when the log did not end in a newline. */
  readonly end: () => readonly string[];
  /** How many lines were cut at the cap so far. */
  readonly truncated: () => number;
}

/**
 * A line splitter for a scan: every line whole up to `lineChars`, every longer one cut there and counted once.
 *
 * @param lineChars the cap
 * @returns the splitter
 */
function githubExposureLogSplitter({ lineChars }: { lineChars: number }): GithubExposureLogSplitter {
  let carry = "";
  let cut = false;
  let truncated = 0;
  return {
    end: () => (carry.length > 0 ? [carry] : []),
    push: ({ chunk }) => {
      const pieces = chunk.split("\n");
      const lines: string[] = [];
      pieces.forEach((piece, index) => {
        if (!cut) {
          carry += piece;
          if (carry.length > lineChars) {
            carry = carry.slice(0, lineChars);
            cut = true;
            truncated += 1;
          }
        }
        if (index < pieces.length - 1) {
          lines.push(carry);
          carry = "";
          cut = false;
        }
      });
      return lines;
    },
    truncated: () => truncated,
  };
}

/** A batcher of kept lines into scan texts, each batch bounded by lines and by characters, offsets carried. */
function logBatcher({
  locator,
  take,
}: {
  locator: string;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): { add: (args: { lines: readonly string[] }) => void; flush: () => void } {
  let batch: string[] = [];
  let batchChars = 0;
  let offset = 0;
  const flush = (): void => {
    if (batch.length === 0) {
      return;
    }
    take({ texts: [{ field: "log", lineOffset: offset, locator, surface: "actions-jobs", text: batch.join("\n") }] });
    offset += batch.length;
    batch = [];
    batchChars = 0;
  };
  const add = ({ lines }: { lines: readonly string[] }): void => {
    for (const line of lines) {
      const kept = stripLogTimestamp({ line });
      batch.push(kept);
      batchChars += kept.length;
      if (batch.length >= EXPOSURE_LOG_BATCH_LINES || batchChars >= EXPOSURE_LOG_BATCH_CHARS) {
        flush();
      }
    }
  };
  return { add, flush };
}

/** Scan one opened log whole: every line batched to `take`, whether the stream broke, how many lines were cut. */
async function scanOneLog({
  chunks,
  lineChars,
  locator,
  take,
}: {
  chunks: AsyncIterable<string>;
  lineChars: number;
  locator: string;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
}): Promise<{ broke: boolean; truncated: number }> {
  const splitter = githubExposureLogSplitter({ lineChars });
  const batcher = logBatcher({ locator, take });
  let broke = false;
  try {
    for await (const chunk of chunks) {
      batcher.add({ lines: splitter.push({ chunk }) });
    }
  } catch {
    broke = true;
  }
  batcher.add({ lines: splitter.end() });
  batcher.flush();
  return { broke, truncated: splitter.truncated() };
}

/**
 * Stream every listed job's log, handing each batch of lines to `take`.
 *
 * @param streamLog the run-log verb's log seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param jobIds every distinct job the inventory listed
 * @param take scans one batch
 * @param lineChars the longest line scanned whole
 * @returns how many logs it asked for, every gap as a count, and the logs GitHub no longer serves as a limit
 */
export async function readGithubExposureLogs({
  streamLog,
  owner,
  repo,
  jobIds,
  take,
  lineChars = EXPOSURE_LOG_LINE_CHARS,
}: {
  streamLog: StreamJobLog;
  owner: string;
  repo: string;
  jobIds: readonly number[];
  take: (args: { texts: readonly GithubExposureText[] }) => void;
  lineChars?: number;
}): Promise<GithubExposureLogsReading> {
  const counts = { failed: 0, truncated: 0, unavailable: 0 };
  for (const jobId of jobIds) {
    const opened = await streamLog({ jobId, owner, repo });
    if (opened.isErr() && opened.error.code === "LOG_UNAVAILABLE") {
      counts.unavailable += 1;
      continue;
    }
    if (opened.isErr()) {
      counts.failed += 1;
      continue;
    }
    const scanned = await scanOneLog({ chunks: opened.value, lineChars, locator: `job ${String(jobId)} log`, take });
    counts.truncated += scanned.truncated;
    counts.failed += scanned.broke ? 1 : 0;
  }
  return logsReading({ calls: jobIds.length, ...counts });
}

/** The stage's reading from its counts: each nonzero count one line, the expired logs a limit. Pure. */
function logsReading({
  calls,
  failed,
  truncated,
  unavailable,
}: {
  calls: number;
  failed: number;
  truncated: number;
  unavailable: number;
}): GithubExposureLogsReading {
  const gaps: string[] = [];
  if (failed > 0) {
    gaps.push(`${String(failed)} job log(s) could not be read in full`);
  }
  if (truncated > 0) {
    gaps.push(`${String(truncated)} log line(s) were longer than the scan keeps and read only in part`);
  }
  const limits =
    unavailable > 0 ? [`${String(unavailable)} job log(s) GitHub no longer serves, so none will be public`] : [];
  return { calls, gaps, limits };
}
