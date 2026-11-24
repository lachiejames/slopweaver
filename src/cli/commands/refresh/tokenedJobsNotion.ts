/**
 * The Notion half of `tokenedJobs.ts` — the grant-delta backfill phase, the incremental crawl, and the
 * durability flush both phases write through; the notes they report are in {@link ./tokenedJobsNotionNotes}.
 * Split out of `tokenedJobs.ts` purely to keep that file under the file-size ratchet's line ceiling; no
 * behaviour moves.
 */

import { writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import { type CoverageGap, coverageGap } from "../../../corpus/ingestJob.js";
import { storeAttachment } from "../../../corpus/notion/attachmentStore.js";
import { NOTION_ATTACHMENT_CEILING_BYTES } from "../../../corpus/notion/attachments.js";
import { makeAttachmentTransport } from "../../../corpus/notion/attachmentTransport.js";
import { storeBody } from "../../../corpus/notion/bodyStore.js";
import { DEFAULT_NOTION_CAPTURE_CAPS, type NotionCaptureCaps, notionCapsNote } from "../../../corpus/notion/caps.js";
import { notionCrawlCoversWindow, recordNotionCaptureCoverage } from "../../../corpus/notion/captureCoverage.js";
import { fetchNotionActivity } from "../../../corpus/notion/fetch.js";
import { makeNotionApi, makeNotionReachApi } from "../../../corpus/notion/liveApi.js";
import { createNotionCrawlMeter, type NotionCrawlMeter } from "../../../corpus/notion/meter.js";
import { type NotionDatabaseItem, type NotionPageItem, projectNotionRecords } from "../../../corpus/notion/project.js";
import { backfillNotionGrantDelta, structureNotionDataSourceIds } from "../../../corpus/notion/reach.js";
import {
  buildNotionSeenIndex,
  EMPTY_NOTION_SEEN_INDEX,
  type NotionSeenIndex,
} from "../../../corpus/notion/seenIndex.js";
import {
  enumerationWasIncomplete,
  type NotionSkip,
  notionCoverageGaps,
  summariseNotionSkips,
} from "../../../corpus/notion/skips.js";
import type { SourceProgress } from "../../../corpus/progress.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { RefreshErrors, type RefreshNotionGrantDeltaFailedError } from "./errors.js";
import { notionDurabilityNotes, notionSpendNotes } from "./tokenedJobsNotionNotes.js";

/** What one grant-delta backfill answers, as the phase, the flush and the final assembly all carry it. */
type NotionGrantDelta = Awaited<ReturnType<typeof backfillNotionGrantDelta>>;

/**
 * Flush one batch of already-projected Notion records to bronze immediately, mutating `spend` with the
 * outcome. The durability checkpoint {@link fetchNotionActivity}'s `onBatch` drives — see `ingestNotion`
 * for why a kill mid-crawl otherwise loses everything.
 *
 * @param home the Slopweaver home the batch writes into
 * @param window the export window the write is filed under
 * @param spend the caller's running write/failure counters, mutated in place per batch
 * @returns the `onBatch` callback `fetchNotionActivity` invokes per databases-lane search page
 */
export function flushNotionBatch({
  home,
  window,
  spend,
}: {
  home: string;
  window: ExportWindow;
  spend: { written: number; failed: number };
}): (args: { records: readonly CorpusRecord[] }) => void {
  return ({ records }) => {
    if (records.length === 0) {
      return;
    }
    const written = writeCorpusRecords({ home, records, window });
    if (written.isOk()) {
      spend.written += written.value.written;
    } else {
      spend.failed += 1;
    }
  };
}

/**
 * Record how far back this crawl re-captured, when it actually earned the claim.
 *
 * A crawl that completed, was not capped, and hit no cursor-withholding gap has re-captured every page
 * edited at or after its own `since` — so from here on, an UNMARKED bronze capture in that range genuinely
 * means a complete one rather than a capture written before the marker existed. `captureCoverage.ts` holds
 * why that fact has to be recorded at all.
 *
 * @param bounded whether `--fetch-cap` cut this run short of its window
 * @param enumerationIncomplete whether any search or data-source query failed recoverably, so part of the
 *   workspace was never enumerated and there is nothing to have marked
 * @param gaps the transient coverage gaps the run reported
 * @param home the Slopweaver home the sidecar lives in
 * @param window the window this crawl was asked for
 * @returns the protect list's refusal lines when the sidecar is covered, so the run warns rather than records
 */
function recordCoverageIfEarned({
  bounded,
  enumerationIncomplete,
  gaps,
  home,
  window,
}: {
  bounded: boolean;
  enumerationIncomplete: boolean;
  gaps: readonly string[];
  home: string;
  window: ExportWindow;
}): readonly string[] {
  const recorded = notionCrawlCoversWindow({ bounded, enumerationIncomplete, gaps })
    ? recordNotionCaptureCoverage({ home, sinceIso: window.since })
    : ok(undefined);
  return recorded.isErr() ? recorded.error : [];
}

/**
 * Build the live Notion seam for one crawl, spreading only the options that were actually supplied.
 *
 * @param fetchCap the `--fetch-cap` item ceiling, if any
 * @param caps the per-item depth/request/time bounds the crawl runs under
 * @param meter the crawl's request/skip counter
 * @param onProgress the connector-level progress sink, if anything is watching
 * @param seen the already-held-unchanged index both lanes consult before fetching
 * @param token the Notion integration token
 * @returns the seam
 */
function notionApiFor({
  fetchCap,
  meter,
  onProgress,
  seen,
  token,
  caps,
  home,
  withAttachments,
}: {
  fetchCap: number | undefined;
  meter: NotionCrawlMeter;
  onProgress: SourceProgress | undefined;
  seen: NotionSeenIndex;
  token: string;
  caps: NotionCaptureCaps;
  home: string;
  withAttachments: boolean;
}): ReturnType<typeof makeNotionApi> {
  const attachments = withAttachments
    ? {
        ceilingBytes: NOTION_ATTACHMENT_CEILING_BYTES,
        store: ({ bytes }: { bytes: Buffer }) => storeAttachment({ bytes, home }),
        transport: makeAttachmentTransport(),
      }
    : undefined;
  return makeNotionApi({
    ...(attachments !== undefined ? { attachments } : {}),
    caps,
    meter,
    seen,
    // Unconditional, unlike attachments: storing the parsed tree adds no provider bytes at rest, and it is
    // what makes re-deriving a page's text a local read (`corpus/notion/bodyStore.ts`). There is no flag to
    // withhold it because there is nothing to withhold it from.
    storeBody: ({ tree }) => storeBody({ home, tree }),
    token,
    ...(fetchCap !== undefined ? { maxItems: fetchCap } : {}),
    ...(onProgress !== undefined ? { onProgress } : {}),
  });
}

/**
 * Fetch + project Notion activity, reporting what it could NOT read as notes + coverage gaps.
 *
 * The skip report goes out through `notes` rather than `warnings` and is emitted UNCONDITIONALLY, including
 * for zero skips. A page an integration cannot see is the normal, permanent state of a Notion workspace, so
 * it is not a warning — but silence about it is the failure mode that matters here: a page whose body was
 * never indexed is invisible to a query, and a run that says nothing is indistinguishable from a run that
 * read everything. Only the TRANSIENT reasons become gaps and hold the watermark back (see `skips.ts`).
 *
 * Bronze writes happen TWICE for the databases lane's content by design: once incrementally per search
 * page as the crawl goes (`flushNotionBatch`, wired below), and once more in the closing write every source
 * gets (`ingestSource.ts`). The first is a durability checkpoint so a kill mid-crawl does not lose
 * everything; the second is the existing, unchanged write path. Both are safe together because
 * `writeCorpusRecords` fingerprint-dedupes — the closing write over already-flushed content is a no-op.
 *
 * A GRANT-DELTA backfill runs FIRST, unconditionally, before the incremental pass below — see
 * `docs/notion-reach.md`. The pages/databases lanes stop paging at the first hit older than `since`
 * (Notion `search` has no server-side date filter), so a page the integration was just granted but that
 * was last edited long ago sits below every incremental window and the crawl below would never reach it at
 * all. `reach.ts` enumerates the whole workspace's current ids (cheap — no content fetch), diffs against
 * what bronze + the structures store already hold, and fully fetches only the delta.
 *
 * @param withAttachments whether this run fetches attachment BYTES. Default true, on the owner's ruling
 *   that they want the full page including its attachments; `--no-notion-attachments` withholds
 *   them, because bytes at rest is the one thing here a caller might reasonably not want on a given machine
 * @returns the ingested records, warnings, notes and gaps, or the ingest failure
 */
export async function ingestNotion({
  token,
  window,
  home,
  onProgress,
  fetchCap,
  refetchUnchanged = false,
  caps = DEFAULT_NOTION_CAPTURE_CAPS,
  withAttachments = true,
}: {
  token: string;
  window: ExportWindow;
  home: string;
  onProgress?: SourceProgress;
  fetchCap?: number;
  refetchUnchanged?: boolean;
  caps?: NotionCaptureCaps;
  withAttachments?: boolean;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    notes: readonly string[];
    gaps: readonly CoverageGap[];
  }>
> {
  const meter = createNotionCrawlMeter();
  const startedAtMs = Date.now();
  const spend = { failed: 0, written: 0 };
  const prepared = await prepareNotionCrawl({ caps, fetchCap, home, refetchUnchanged, spend, token, window });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const { phase, seen } = prepared.value;
  const api = notionApiFor({ caps, fetchCap, home, meter, onProgress, seen, token, withAttachments });
  const fetched = await fetchNotionActivity({
    api,
    onBatch: flushNotionBatch({ home, spend, window }),
    window,
    ...(onProgress !== undefined ? { onProgress } : {}),
  });
  if (fetched.isErr()) {
    return err([fetched.error.message]);
  }
  return ok(
    finaliseNotionIngest({
      backfill: phase.backfill,
      caps,
      fetchCap,
      fetched: fetched.value,
      home,
      meter,
      seen,
      spend,
      startedAtMs,
      window,
    }),
  );
}

/**
 * Run the grant-delta phase, then rebuild the unchanged-index from what it left on disk.
 *
 * The ORDER is the point and is why these two are one step: the index is rebuilt AFTER the delta lands, so
 * the incremental pass cannot re-fetch a delta id that also happens to fall inside its own `since` window.
 *
 * @param refetchUnchanged when true, no index is built at all and every item is re-fetched
 * @param spend the run's write/failure counters, which the delta phase's own flush already advances
 * @returns the delta phase's result and the index the crawl should consult, or the phase's failure
 */
async function prepareNotionCrawl({
  caps,
  fetchCap,
  home,
  refetchUnchanged,
  spend,
  token,
  window,
}: {
  caps: NotionCaptureCaps;
  fetchCap: number | undefined;
  home: string;
  refetchUnchanged: boolean;
  spend: { failed: number; written: number };
  token: string;
  window: ExportWindow;
}): Promise<Result<{ phase: { backfill: NotionGrantDelta }; seen: NotionSeenIndex }>> {
  // Read ONCE, judged by the owner's protect list, before any provider call: a refused Notion bronze is the whole
  // source's refusal, and the grant-delta phase's held ids come from this same scan.
  const heldSeen = await buildNotionSeenIndex({ home });
  if (heldSeen.isErr()) {
    return err(heldSeen.error);
  }
  const phase = await runNotionGrantDeltaPhase({
    caps,
    fetchCap,
    heldSeen: heldSeen.value,
    home,
    spend,
    token,
    window,
  });
  if (phase.isErr()) {
    // The job contract (`SourceIngestJob.run`, `corpus/ingestJob.ts`) carries display lines, so the typed
    // failure becomes its message at this one boundary.
    return err([phase.error.message]);
  }
  if (refetchUnchanged) {
    return ok({ phase: phase.value, seen: EMPTY_NOTION_SEEN_INDEX });
  }
  // Re-read AFTER the phase, as before: its flush appended the backfilled pages, which the crawl must now skip.
  const seen = await buildNotionSeenIndex({ home });
  if (seen.isErr()) {
    return err(seen.error);
  }
  return ok({ phase: phase.value, seen: seen.value });
}

/**
 * Assemble the final Notion ingest result — coverage bookkeeping + the combined notes/records from both the
 * grant-delta phase and the incremental crawl. Extracted purely to keep {@link ingestNotion} under the line
 * ceiling; no behaviour moves.
 *
 * @param backfill the grant-delta phase's result
 * @param fetched the incremental crawl's already-unwrapped success value
 * @param spend the run's accumulated write/failure counters from both phases' flushes
 * @param meter the crawl's request/skip counter
 * @param seen the unchanged-index the incremental crawl consulted
 * @param startedAtMs when the incremental crawl began (for the throughput note)
 * @param fetchCap the `--fetch-cap` ceiling, if any (decides whether coverage can be recorded)
 * @param home the Slopweaver home the coverage sidecar lives in
 * @param window the window this crawl was asked for
 * @param caps the bounds the crawl ran under, reported as its first note
 * @returns the combined ingest result
 */
function finaliseNotionIngest({
  backfill,
  fetched,
  spend,
  meter,
  seen,
  startedAtMs,
  fetchCap,
  home,
  window,
  caps,
}: {
  backfill: NotionGrantDelta;
  fetched: {
    pages: readonly NotionPageItem[];
    databases: readonly NotionDatabaseItem[];
    warnings: readonly string[];
    skips: readonly NotionSkip[];
    notes: readonly string[];
  };
  spend: { written: number; failed: number };
  meter: NotionCrawlMeter;
  seen: NotionSeenIndex;
  startedAtMs: number;
  fetchCap: number | undefined;
  home: string;
  window: ExportWindow;
  caps: NotionCaptureCaps;
}): {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
} {
  const gaps = notionCoverageGaps({ skips: fetched.skips });
  const refused = recordCoverageIfEarned({
    bounded: fetchCap !== undefined,
    enumerationIncomplete: enumerationWasIncomplete({ skips: fetched.skips }),
    gaps,
    home,
    window,
  });
  return {
    gaps: gaps.map((message) => coverageGap({ message })),
    notes: [
      notionCapsNote({ caps }),
      backfill.summary,
      ...summariseNotionSkips({ skips: [...backfill.skips, ...fetched.skips] }),
      ...fetched.notes,
      ...backfill.notes,
      ...notionDurabilityNotes({ spend }),
      ...notionSpendNotes({ elapsedMs: Date.now() - startedAtMs, meter, seen }),
    ],
    records: [...projectNotionRecords(backfill), ...projectNotionRecords(fetched)],
    warnings: [...fetched.warnings, ...refused],
  };
}

/**
 * Run the grant-delta phase for one Notion crawl: build the held-id sets bronze + the structures store
 * already know about, backfill the delta against the live reach seam, and flush it to bronze. Extracted so
 * {@link ingestNotion} stays focused on sequencing the two phases rather than running this one itself.
 *
 * A phase failure (an auth rejection, an exhausted retry budget) is FATAL for the whole Notion source,
 * exactly like `fetchNotionActivity`'s own catch-all below it — grant-delta detection shares the one token
 * and the one rate budget, so a failure this early means the incremental pass would fail identically anyway.
 *
 * @param token the Notion integration token
 * @param home the Slopweaver home the structures store + bronze are read from and flushed into
 * @param fetchCap the `--fetch-cap` item ceiling for the backfill half (enumeration is always unbounded)
 * @param window the export window the flush is filed under
 * @param spend the caller's running write/failure counters, mutated in place by the flush
 * @param caps the per-item depth/request/time bounds the backfill's own item crawls run under
 * @param heldSeen the REAL bronze scan the held ids come from, already judged by the owner's protect list
 * @returns the backfilled delta, or the fatal failure as an `err`
 */
async function runNotionGrantDeltaPhase({
  token,
  home,
  fetchCap,
  window,
  spend,
  caps,
  heldSeen,
}: {
  token: string;
  home: string;
  fetchCap: number | undefined;
  window: ExportWindow;
  spend: { written: number; failed: number };
  caps: NotionCaptureCaps;
  heldSeen: NotionSeenIndex;
}): Promise<Result<{ backfill: NotionGrantDelta }, RefreshNotionGrantDeltaFailedError>> {
  // Held ids always come from the REAL bronze scan, regardless of `--refetch-unchanged`: that flag governs
  // whether the CONTENT skip is trusted, never whether an id is already known to be reachable. Reading it
  // off `EMPTY_NOTION_SEEN_INDEX` instead would report the entire workspace as newly granted every time the
  // flag is passed.
  const heldDatabaseIds = new Set([...heldSeen.heldDatabaseIds, ...structureNotionDataSourceIds({ home })]);
  let backfill: NotionGrantDelta;
  try {
    backfill = await backfillNotionGrantDelta({
      api: makeNotionReachApi({
        caps,
        storeBody: ({ tree }) => storeBody({ home, tree }),
        token,
        ...(fetchCap !== undefined ? { fetchCap } : {}),
      }),
      heldDatabaseIds,
      heldPageIds: heldSeen.heldPageIds,
    });
  } catch (error: unknown) {
    return err(RefreshErrors.notionGrantDeltaFailed({ cause: error }));
  }
  flushNotionBatch({ home, spend, window })({ records: projectNotionRecords(backfill) });
  return ok({ backfill });
}
