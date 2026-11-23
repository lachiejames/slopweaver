/**
 * The `gmail` source's ingest job — crawl → project → re-anchor, wrapped in the ONE per-source seam
 * ({@link ../ingestJob.SourceIngestJob}) so mail flows through the same redact → dedup → JSONL write,
 * the same pooled watermark and the same run summary as every other source. Deliberately not a second door
 * into bronze: `refresh` stays the only writer.
 *
 * ## The anchor is written AFTER the write, and only when the cursor is allowed to move
 *
 * The `historyId` anchor is a second cursor layer, so it has to obey the same rule the pooled one does: a
 * run that did not see its whole window must not move it. The two are advanced by different code —
 * {@link ../ingestSource.ingestSources} owns the pooled cursor and this file owns the anchor — so the rule
 * is restated here rather than inherited, and the shape of the restatement is what keeps it honest:
 *
 *  - a crawl reporting a COVERAGE GAP does not re-anchor, so the next pass asks the same question again;
 *  - a crawl whose write FAILED does not re-anchor, because the messages it read are not on disk;
 *  - a CAPPED run (`--sample`/`--fetch-cap`) does not re-anchor either, and this is the one the shared
 *    machinery cannot do for us. `ingestSources` holds the POOLED cursor for a capped run, but it has never
 *    heard of the anchor — so without the explicit branch in {@link reanchor}, `--sample 3` would anchor as
 *    though it had ingested the whole mailbox and every later run would resume past what it skipped.
 *
 * The failure this prevents is the expensive one and it has a name in this repository: a cursor that moved
 * past data the API really has, with the run reporting success and nothing recording that a gap existed.
 *
 * ## Why it commits before it anchors rather than the other way round
 *
 * Anchoring first and writing second would, on a crash between them, lose the messages AND claim they were
 * seen. Writing first and anchoring second loses only the anchor, and the recovery for a missing anchor is
 * one window crawl whose records all dedup away. The asymmetry decides the order.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "../../live/gmail/api.js";
import { makeGmailApi } from "../../live/gmail/api.js";
import { resolveGmailClient } from "../../live/gmail/client.js";
import type { DocContent, GoogleDocsApi } from "../../live/gmail/docs.js";
import { makeGoogleDocsApi } from "../../live/gmail/docs.js";
import { GMAIL_SCOPE_TABLE } from "../../live/gmail/scopes.js";
import { satisfiesCapability } from "../../live/google/scopes.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import { newestTs } from "../newestTs.js";
import type { SourceProgress } from "../progress.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { crawlGmail, type GmailCrawlResult, type GmailReadCap } from "./fetch.js";
import {
  readGmailBackfillFloor,
  readGmailHistoryAnchor,
  writeGmailBackfillFloor,
  writeGmailHistoryAnchor,
} from "./historyAnchor.js";
import { droppedAcross, gmailIngestNotes, transcriptCharsAcross } from "./ingestNotes.js";
import { fetchMeetingDocs } from "./meetingDocs.js";
import { projectGmailMessages } from "./project.js";

/**
 * The `since` that means "the whole mailbox".
 *
 * Deliberately a local mirror of `refresh`'s own `EPOCH_SINCE` rather than an import of it: that constant
 * lives in `src/cli/commands/refresh/core.ts`, and a connector reaching up into the CLI to read it would
 * invert the dependency this whole layer is arranged around. The value is a date literal that has never
 * moved, and the mirror is compared by PREFIX so a widened `EPOCH_SINCE` carrying a time component would
 * still match.
 */
const EPOCH_SINCE_PREFIX = "1970-01-01";

/**
 * Whether a window asks for the whole mailbox.
 *
 * @param window the planned export window
 * @returns true when the window starts at the epoch, so a window crawl covers everything
 */
export function isEpochWide({ window }: { window: ExportWindow }): boolean {
  return window.since.startsWith(EPOCH_SINCE_PREFIX);
}

/**
 * Build the `gmail` ingest job.
 *
 * The API seam is injectable so the job's ORDERING — commit, then anchor, and neither when the crawl
 * reported a gap — is testable without a mailbox. In production it resolves the stored grant, which is also
 * where a missing grant or a too-narrow one is refused by name.
 *
 * @param home the Slopweaver home holding the grant, the bronze store and the anchor
 * @param window the planned export window, used by the window lane and to name the bronze file
 * @param nowIso the clock, for the anchor's recorded time
 * @param api the Gmail seam; omitted in production, where the stored grant resolves one
 * @param docsApi the Google Docs seam the meeting-transcript lane reads through; omitted in production,
 *   where it is built from the same grant when that grant carries the Docs scope
 * @param sample the `--sample` cap, which bounds this lane's own commit and HOLDS its anchor
 * @param fetchCap the `--fetch-cap` cap, same effect — see {@link readCap}
 * @param onProgress the connector progress seam, so a first full crawl is visible rather than looking hung
 * @param cursorOverridden whether the caller named an explicit window (`--since`/`--all`/`--lookback-days`),
 *   which must beat the stored anchor exactly as it already beats every other source's cursor
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function gmailIngestJob({
  home,
  window,
  nowIso,
  api,
  docsApi,
  sample,
  fetchCap,
  onProgress,
  cursorOverridden = false,
}: {
  home: string;
  window: ExportWindow;
  nowIso: () => string;
  api?: GmailApi;
  docsApi?: GoogleDocsApi;
  sample?: number;
  fetchCap?: number;
  onProgress?: SourceProgress;
  cursorOverridden?: boolean;
}): SourceIngestJob {
  const cap = readCap({ fetchCap, sample });
  return {
    label: "gmail (mailbox)",
    run: () => runGmailIngest({ api, cap, cursorOverridden, docsApi, home, nowIso, onProgress, window }),
    source: "gmail",
    window,
  };
}

/**
 * The read bound a `--sample`/`--fetch-cap` run puts on this lane, when either was given.
 *
 * Both flags collapse to one number here because a mailbox is ONE container, which is what makes the two
 * distinct elsewhere: `--sample` caps records per container after the fetch and `--fetch-cap` caps the fetch
 * per lane, and with a single container those are the same bound. The TIGHTER of the two wins, so passing
 * both never widens either. Pure.
 *
 * @param sample the `--sample` cap, when set
 * @param fetchCap the `--fetch-cap` cap, when set
 * @returns the cap to apply, or undefined for an unbounded run
 */
export function readCap({
  sample,
  fetchCap,
}: {
  sample: number | undefined;
  fetchCap: number | undefined;
}): GmailReadCap | undefined {
  const bounds = [sample, fetchCap].filter((value): value is number => value !== undefined);
  return bounds.length === 0 ? undefined : { maxMessages: Math.min(...bounds) };
}

/** What one gmail ingest pass reports back through the shared per-source seam. */
type GmailIngestOutcome = Result<{
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer?: number;
  projectedPerContainer?: number;
  committedCursor?: string;
}>;

/**
 * One ingest pass: resolve the seam, crawl, project, commit, then re-anchor — in that order, which is the
 * whole of this module's contract.
 *
 * @param home the Slopweaver home holding the grant, the bronze store and the anchor
 * @param window the planned export window
 * @param nowIso the clock, for the anchor's recorded time
 * @param api the injected Gmail seam, when a caller supplied one
 * @param cap the caller's deliberate read bound, when `--sample`/`--fetch-cap` set one
 * @param cursorOverridden whether an explicit window was named, which makes the lane ignore the anchor
 * @param docsApi the injected Docs seam, or undefined when the grant does not carry the Docs scope
 * @param onProgress the connector progress seam
 * @returns what the pass wrote and what it could not cover
 */
async function runGmailIngest({
  api,
  cap,
  cursorOverridden,
  docsApi,
  home,
  nowIso,
  onProgress,
  window,
}: {
  api: GmailApi | undefined;
  cap: GmailReadCap | undefined;
  cursorOverridden: boolean;
  docsApi: GoogleDocsApi | undefined;
  home: string;
  nowIso: () => string;
  onProgress: SourceProgress | undefined;
  window: ExportWindow;
}): Promise<GmailIngestOutcome> {
  const resolved = resolveApi({ api, docsApi, home });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const crawled = await crawlGmail({
    // An EXPLICIT window beats the anchor, exactly as it already beats every other source's cursor. Without
    // this the lane branches on the anchor's presence alone, so `--all --accept-full-history` — the
    // documented way to backfill a whole mailbox — took the delta lane and reported "0 message(s) added
    // since". Observed on a real run: `--since <day>` was planned into the window, printed in the
    // window line, and then ignored. A flag the run ECHOES and does not honour is worse than one it rejects.
    anchor: cursorOverridden ? undefined : readGmailHistoryAnchor({ home }),
    api: resolved.value.api,
    // Read even when the caller overrode the cursor, because `--all --accept-full-history` IS the caller
    // asking to resume the backfill: a full-history run that ignored the floor would start again at today
    // and re-walk to the same ceiling, which is the loop the floor exists to break.
    backfillFloorIso: readGmailBackfillFloor({ home })?.floorIso,
    cap,
    epochWide: isEpochWide({ window }),
    onProgress,
    window,
  });
  if (crawled.isErr()) {
    return err([crawled.error.message]);
  }
  // Follows the Google Doc link of every recognised Gemini meeting-notes email in the batch — the one
  // network step this connector makes outside the mail API, and the one that turns a summary notification
  // into a meeting record. Failures are warnings; see {@link ./meetingDocs.fetchMeetingDocs}.
  const meetings = await fetchMeetingDocs({ docsApi: resolved.value.docsApi, messages: crawled.value.messages });
  return commitCrawl({
    crawled: { ...crawled.value, warnings: [...crawled.value.warnings, ...meetings.warnings] },
    home,
    meetingDocs: meetings.documents,
    nowIso,
    window,
  });
}

/**
 * Project and commit a completed crawl, then re-anchor — never the other way round.
 *
 * The records are committed HERE rather than handed to the bulk write, so the anchor is only ever written
 * after the records it claims to cover are on disk. Everything goes in one commit — a mailbox is one
 * container, so there is no per-container progress to bank — and the bulk write is then handed nothing,
 * which is why both per-container counts are reported.
 *
 * @param crawled what the crawl produced
 * @param home the Slopweaver home
 * @param window the export window, which names the bronze file
 * @param nowIso the clock
 * @param meetingDocs the linked document per recognised meeting-notes email, keyed by message id
 * @returns the pass outcome, or the write failure that stopped it before anything was anchored
 */
function commitCrawl({
  crawled,
  home,
  window,
  nowIso,
  meetingDocs,
}: {
  crawled: GmailCrawlResult;
  home: string;
  window: ExportWindow;
  nowIso: () => string;
  meetingDocs: ReadonlyMap<string, DocContent>;
}): GmailIngestOutcome {
  const projected = projectGmailMessages({ meetingDocs, messages: crawled.messages });
  const written = createBronzeCommitter({ home, window }).commit({ records: projected.records });
  if (written.isErr()) {
    return err(written.error);
  }
  const anchored = reanchor({
    capped: crawled.capped,
    fullCrawl: crawled.fullCrawl,
    gaps: crawled.gaps,
    home,
    nextHistoryId: crawled.nextHistoryId,
    nowIso,
  });
  // Written independently of the anchor, and AFTER the commit for the same reason the anchor is: an
  // epoch-wide crawl that stopped at the ceiling has a gap, a gap withholds the anchor, and the floor is
  // exactly the progress that run did make. Folding the two into one write would discard it.
  const floored = moveBackfillFloor({ home, nowIso, transition: crawled.backfillFloor });
  const committedCursor = newestTs({ records: projected.records });
  return ok({
    committedPerContainer: written.value.written,
    // Without this the POOLED cursor never moves at all, and the reason is worth stating because it is not
    // obvious: this lane commits its own records and hands the bulk write an empty list, so
    // `computeSourceWatermarks` sees no records for `gmail` and returns nothing to advance. The result is
    // not a skip — the anchor governs the delta lane — but every run would re-plan the same 90-day window
    // and its own log line would claim a resume that never happened. `committedCursor` is the field the
    // ingest shell provides for exactly this shape.
    ...(committedCursor !== undefined ? { committedCursor } : {}),
    gaps: crawled.gaps.map((message) => coverageGap({ message })),
    notes: [
      ...crawled.notes,
      ...floored.notes,
      ...gmailIngestNotes({
        anchored: anchored.line,
        lane: crawled.lane,
        projected: projected.records.length,
        quotedCharsDropped: droppedAcross({ records: projected.records }),
        transcriptChars: transcriptCharsAcross({ records: projected.records }),
        transcripts: projected.records.filter((record) => record.kind === "transcript").length,
      }),
    ],
    projectedPerContainer: projected.records.length,
    records: [],
    warnings: [...crawled.warnings, ...projected.warnings, ...anchored.warnings, ...floored.warnings],
  });
}

/**
 * Write the new anchor, unless this run is not entitled to move a cursor.
 *
 * @param gaps the coverage gaps the crawl reported; any at all withholds the anchor
 * @param capped whether a `--sample`/`--fetch-cap` bound stopped the crawl short, which also withholds it
 * @param nextHistoryId the anchor the crawl established, when it established one
 * @param fullCrawl whether this crawl covered the mailbox from the epoch
 * @param home the Slopweaver home
 * @param nowIso the clock
 * @returns the note line to print when an anchor was written, and any warning from failing to
 */
function reanchor({
  gaps,
  capped,
  nextHistoryId,
  fullCrawl,
  home,
  nowIso,
}: {
  gaps: readonly string[];
  capped: boolean;
  nextHistoryId: string | undefined;
  fullCrawl: boolean;
  home: string;
  nowIso: () => string;
}): { line: string | undefined; warnings: readonly string[] } {
  if (gaps.length > 0) {
    return {
      line: "history anchor HELD — this crawl did not cover its whole window, so the next run re-asks",
      warnings: [],
    };
  }
  // A DIFFERENT reason from a gap, and it has to be checked separately. A gap means the crawl could not see
  // its window; this means the caller asked it not to. `ingestSources` already holds the pooled cursor for a
  // sampled or fetch-capped run, but it knows nothing about this second cursor — so without this branch a
  // `--sample 3` run would anchor as though it had ingested the whole mailbox, and every later run would
  // resume past everything it skipped. That is the permanent-skip class this repo has paid for before.
  if (capped) {
    return {
      line: "history anchor HELD — this run was deliberately capped, so it saw only part of what its lane offered",
      warnings: [],
    };
  }
  if (nextHistoryId === undefined) {
    return {
      line: undefined,
      warnings: ["no history anchor could be established, so the next run will crawl by date window again"],
    };
  }
  const stored = writeGmailHistoryAnchor({ fullCrawl, historyId: nextHistoryId, home, nowIso: nowIso() });
  if (stored.isErr()) {
    return { line: undefined, warnings: stored.error };
  }
  return { line: `history anchor advanced to ${nextHistoryId}`, warnings: [] };
}

/**
 * Apply the crawl's backfill-floor transition to the store.
 *
 * @param transition what the crawl said the floor should become
 * @param home the Slopweaver home
 * @param nowIso the clock
 * @returns the note lines to print, and any warning from failing to write
 */
function moveBackfillFloor({
  transition,
  home,
  nowIso,
}: {
  transition: GmailCrawlResult["backfillFloor"];
  home: string;
  nowIso: () => string;
}): { notes: readonly string[]; warnings: readonly string[] } {
  if (transition.kind === "hold") {
    return { notes: [], warnings: [] };
  }
  const existing = readGmailBackfillFloor({ home });
  if (transition.kind === "clear" && existing === undefined) {
    return { notes: [], warnings: [] };
  }
  const written = writeGmailBackfillFloor({
    floorIso: transition.kind === "clear" ? undefined : transition.floorIso,
    home,
    nowIso: nowIso(),
  });
  if (written.isErr()) {
    return { notes: [], warnings: written.error };
  }
  return {
    notes: [
      transition.kind === "clear"
        ? "full-history backfill CONVERGED — the whole mailbox is crawled, and the backfill floor is cleared"
        : `full-history backfill floor moved back to ${transition.floorIso} — run --all again to continue`,
    ],
    warnings: [],
  };
}

/**
 * The API seam for this run: the injected one, else one built from the stored grant.
 *
 * @param api the injected seam, when a caller supplied one
 * @param docsApi the injected Docs seam, when a caller supplied one
 * @param home the Slopweaver home holding the grant
 * @returns both seams, or the caller-facing reason the grant could not be used
 */
function resolveApi({
  api,
  docsApi,
  home,
}: {
  api: GmailApi | undefined;
  docsApi: GoogleDocsApi | undefined;
  home: string;
}): Result<{ api: GmailApi; docsApi: GoogleDocsApi | undefined }> {
  if (api !== undefined) {
    return ok({ api, docsApi });
  }
  // `read` alone, never `["read", "docs"]`. A grant that never approved the Docs scope must still ingest
  // mail — the transcript is an enrichment, and refusing the whole crawl over a declined optional scope
  // would make an install that works today stop working the moment this feature landed.
  const client = resolveGmailClient({ capabilities: ["read"], home });
  if (client.isErr()) {
    return err([client.error.message]);
  }
  const canReadDocs = satisfiesCapability({
    capability: "docs",
    granted: client.value.scopes,
    table: GMAIL_SCOPE_TABLE,
  });
  return ok({
    api: makeGmailApi({ account: client.value.account, client: client.value.client }),
    docsApi: canReadDocs ? makeGoogleDocsApi({ account: client.value.account, auth: client.value.auth }) : undefined,
  });
}
