/**
 * Commit a handful of meeting transcripts to gmail bronze outside a refresh — `gmail clear-meeting-notes`'s one
 * bronze write, for a meeting whose notes mail is in the inbox but whose transcript no refresh stored yet.
 *
 * ## Why it is not a second writer
 *
 * The records come from `./project.ts`'s `meetingProjection`, the exact code a refresh projects a transcript with,
 * and they go through the ONE bronze committer (`../corpusWriter.ts`'s `createBronzeCommitter`) — the same
 * denylist, redaction and dedup every refresh write takes, the shape `fathom share` already commits one call by.
 * A later refresh that crawls the same mail dedups against it.
 *
 * ## It takes the gmail refresh slot, and touches no cursor
 *
 * Two writers appending to gmail bronze at once can both miss each other in their dedup indices, so this takes
 * the slot every refresh and compaction of gmail takes (`../refreshSlot.ts`) and releases it on the way out —
 * the verb runs inside the recipe runner's process, where a slot held until exit would refuse every refresh
 * behind it. It never writes the history anchor, the backfill floor or the pooled watermark: a targeted commit is
 * not a crawl, and moving a cursor for it would make the next refresh skip mail it never read.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { acquireRefreshSlot, releaseRefreshSlot } from "../refreshSlot.js";
import type { CorpusRecord, ExportWindow } from "../types.js";

/** What one targeted commit wrote. */
export interface MeetingTranscriptCommitReport {
  /** The window the records were filed under; undefined when there was nothing to commit. */
  readonly window: ExportWindow | undefined;
  readonly written: number;
  readonly deduped: number;
  /** Records the install's sync denylist kept out of bronze — never held, so never provable. */
  readonly excluded: number;
}

/** Another process holds the gmail refresh slot, so nothing was written. */
export interface RefreshSlotHeldError {
  readonly code: "REFRESH_SLOT_HELD";
  readonly message: string;
  readonly holderPid: number;
}

/** The gmail refresh slot could not be taken at all — no holder to name — so nothing was written. */
export interface RefreshSlotUnavailableError {
  readonly code: "REFRESH_SLOT_UNAVAILABLE";
  readonly message: string;
  readonly obstacles: readonly string[];
}

/** The bronze committer refused the write. */
export interface BronzeWriteFailedError {
  readonly code: "BRONZE_WRITE_FAILED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Why a targeted meeting-transcript commit wrote nothing. */
export type GmailMeetingCommitError = RefreshSlotHeldError | RefreshSlotUnavailableError | BronzeWriteFailedError;

/** The {@link GmailMeetingCommitError} factories. */
export const GmailMeetingCommitErrors = {
  bronzeWriteFailed: ({ problems }: { problems: readonly string[] }): BronzeWriteFailedError => ({
    code: "BRONZE_WRITE_FAILED",
    message: `gmail bronze write failed: ${problems.join("; ")}`,
    problems,
  }),
  refreshSlotHeld: ({ holderPid }: { holderPid: number }): RefreshSlotHeldError => ({
    code: "REFRESH_SLOT_HELD",
    holderPid,
    message: `a refresh or compaction of gmail is already running (pid ${String(holderPid)}) — not writing beside it; the next pass commits`,
  }),
  refreshSlotUnavailable: ({ obstacles }: { obstacles: readonly string[] }): RefreshSlotUnavailableError => ({
    code: "REFRESH_SLOT_UNAVAILABLE",
    message: `gmail's refresh slot could not be taken: ${obstacles.join("; ")} — not writing without it; the next pass commits`,
    obstacles,
  }),
} as const;

/**
 * The window a set of records is filed under: the first and last calendar day their own instants fall on, the
 * shape `fathom share` names its one call's window by. Pure.
 *
 * @param records the records about to be committed
 * @returns the inclusive day window, or undefined for no records
 */
export function meetingTranscriptWindow({ records }: { records: readonly CorpusRecord[] }): ExportWindow | undefined {
  const days = records.map((record) => record.tsIso.slice(0, "YYYY-MM-DD".length)).toSorted();
  const since = days[0];
  const until = days.at(-1);
  if (since === undefined || until === undefined) {
    return undefined;
  }
  return { since, until };
}

/**
 * Commit meeting-transcript records to gmail bronze under the gmail refresh slot, moving no cursor.
 *
 * @param home the Slopweaver home whose bronze is written
 * @param records the projected transcript records
 * @param slotRoot the refresh-slot root, overridable so a test never touches the machine-wide directory
 * @returns what was written, or why nothing was
 */
export function commitMeetingTranscripts({
  home,
  records,
  slotRoot,
}: {
  home: string;
  records: readonly CorpusRecord[];
  slotRoot?: string;
}): Result<MeetingTranscriptCommitReport, GmailMeetingCommitError> {
  const window = meetingTranscriptWindow({ records });
  if (window === undefined) {
    return ok({ deduped: 0, excluded: 0, window: undefined, written: 0 });
  }
  const root = slotRoot === undefined ? {} : { root: slotRoot };
  const verdict = acquireRefreshSlot({ source: "gmail", ...root });
  if (!verdict.admitted) {
    const holder = verdict.holders[0];
    if (holder === undefined) {
      return err(GmailMeetingCommitErrors.refreshSlotUnavailable({ obstacles: verdict.obstacles }));
    }
    return err(GmailMeetingCommitErrors.refreshSlotHeld({ holderPid: holder.pid }));
  }
  try {
    const written = createBronzeCommitter({ home, window }).commit({ records });
    if (written.isErr()) {
      return err(GmailMeetingCommitErrors.bronzeWriteFailed({ problems: written.error }));
    }
    return ok({
      deduped: written.value.deduped,
      excluded: written.value.excluded,
      window,
      written: written.value.written,
    });
  } finally {
    releaseRefreshSlot({ source: "gmail", ...root });
  }
}
