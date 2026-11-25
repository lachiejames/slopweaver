/**
 * The `outlook-calendar` source's ingest job — crawl, project, commit, then re-anchor, through the ONE
 * per-source seam ({@link ../ingestJob.SourceIngestJob}), exactly the order the Google lane keeps
 * (`../calendar/ingest.ts` says why commit comes before anchor, and why every anchor is all-or-nothing).
 *
 * The rule restated, because this file owns the per-calendar modified-time anchors and the shared machinery
 * has never heard of them: a crawl with a COVERAGE GAP, a failed WRITE, or a CAP (`--sample`/`--fetch-cap`)
 * moves no anchor. A capped read saw only the events it happened to be served, so banking the instant it
 * began would claim every edit before it, including those the cap left unread.
 *
 * ## A meeting moved EARLIER is a newer version, not a stale one
 *
 * A record's `tsIso` is the event's START, which a reschedule moves either way, so bronze does not order this
 * source's versions by it: `../recordVersion.ts` orders them by the `updatedIso` attr the projection keeps (the
 * event's `lastModifiedDateTime`), for the writer and the latest view alike. The Google diary (`../calendar/`)
 * takes the same rule.
 */
import { err, ok, type Result } from "#lib/result.js";
import { resolveOutlookCalendarGraph } from "../../live/outlook/session.js";
import { makeOutlookCalendarApi, type OutlookCalendarApi } from "../../live/outlookCalendar/api.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import { newestTsAtClock } from "../newestTs.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { crawlOutlookCalendars, type OutlookCalendarCrawlResult, type OutlookCalendarReadCap } from "./fetch.js";
import { projectOutlookCalendarEvents } from "./project.js";
import {
  type OutlookCalendarSyncAnchor,
  readOutlookCalendarSyncAnchors,
  writeOutlookCalendarSyncAnchors,
} from "./syncAnchor.js";

/**
 * The read bound a `--sample`/`--fetch-cap` run puts on this lane: the tighter of the two, per calendar,
 * because a calendar IS a container here. Pure.
 *
 * @param sample the `--sample` cap, when set
 * @param fetchCap the `--fetch-cap` cap, when set
 * @returns the cap to apply, or undefined for an unbounded run
 */
export function outlookCalendarReadCap({
  sample,
  fetchCap,
}: {
  sample: number | undefined;
  fetchCap: number | undefined;
}): OutlookCalendarReadCap | undefined {
  const bounds = [sample, fetchCap].filter((value): value is number => value !== undefined);
  if (bounds.length === 0) {
    return undefined;
  }
  return { maxEvents: Math.min(...bounds) };
}

/**
 * Build the `outlook-calendar` ingest job.
 *
 * @param home the Slopweaver home holding the Microsoft grant, the bronze store and the anchors
 * @param window the planned export window, which names the bronze file; the crawl itself is not time-bounded
 * @param nowIso the clock, for each anchor's recorded time and the pooled cursor's clamp
 * @param api the calendar seam; omitted in production, where the stored Microsoft grant resolves one
 * @param sample the `--sample` cap, which bounds the read and HOLDS every anchor
 * @param fetchCap the `--fetch-cap` cap, same effect
 * @param cursorOverridden whether the caller named an explicit window, which reads every calendar whole
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function outlookCalendarIngestJob({
  home,
  window,
  nowIso,
  api,
  sample,
  fetchCap,
  cursorOverridden,
}: {
  home: string;
  window: ExportWindow;
  nowIso: () => string;
  api: OutlookCalendarApi | undefined;
  sample: number | undefined;
  fetchCap: number | undefined;
  cursorOverridden: boolean;
}): SourceIngestJob {
  const cap = outlookCalendarReadCap({ fetchCap, sample });
  return {
    label: "outlook-calendar (diary)",
    run: () => runOutlookCalendarIngest({ api, cap, cursorOverridden, home, nowIso, window }),
    source: "outlook-calendar",
    window,
  };
}

/** What one pass reports back through the shared per-source seam. */
type OutlookCalendarIngestOutcome = Result<{
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer?: number;
  projectedPerContainer?: number;
  committedCursor?: string;
}>;

/** Resolve the production seam from the calendar's grant, unless a caller injected one. */
async function resolveApi({
  api,
  home,
}: {
  api: OutlookCalendarApi | undefined;
  home: string;
}): Promise<Result<OutlookCalendarApi>> {
  if (api !== undefined) {
    return ok(api);
  }
  const bound = await resolveOutlookCalendarGraph({ home });
  if (bound.isErr()) {
    return err([bound.error.message]);
  }
  return ok(makeOutlookCalendarApi({ graph: bound.value.graph, rateScopeKey: bound.value.account }));
}

/** One pass: resolve, crawl, then commit and re-anchor. */
async function runOutlookCalendarIngest({
  api,
  cap,
  cursorOverridden,
  home,
  nowIso,
  window,
}: {
  api: OutlookCalendarApi | undefined;
  cap: OutlookCalendarReadCap | undefined;
  cursorOverridden: boolean;
  home: string;
  nowIso: () => string;
  window: ExportWindow;
}): Promise<OutlookCalendarIngestOutcome> {
  const resolved = await resolveApi({ api, home });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const crawled = await crawlOutlookCalendars({
    anchors: readOutlookCalendarSyncAnchors({ home }),
    api: resolved.value,
    cap,
    cursorOverridden,
    nowIso,
  });
  if (crawled.isErr()) {
    return err([crawled.error.message]);
  }
  return commitCrawl({ crawled: crawled.value, home, nowIso, window });
}

/** Project and commit a crawl, then re-anchor — never the other way round. */
function commitCrawl({
  crawled,
  home,
  window,
  nowIso,
}: {
  crawled: OutlookCalendarCrawlResult;
  home: string;
  window: ExportWindow;
  nowIso: () => string;
}): OutlookCalendarIngestOutcome {
  const projected = projectOutlookCalendarEvents({
    events: crawled.pages.flatMap((page) => page.events.map((event) => ({ calendar: page.calendar, event }))),
  });
  const written = createBronzeCommitter({ home, window }).commit({ records: projected.records });
  if (written.isErr()) {
    return err(written.error);
  }
  const anchored = reanchor({ crawled, home, nowIso });
  // The newest record clamped to the clock: an event's `tsIso` is its START, so a diary's newest record can sit
  // months ahead (`../newestTs.ts`'s `newestTsAtClock` says why banking that would be wrong).
  const committedCursor = newestTsAtClock({ nowIso: nowIso(), records: projected.records });
  return ok({
    committedPerContainer: written.value.written,
    // This lane commits its own records and hands the bulk write none, so without this the pooled cursor
    // would never move (`../calendar/ingest.ts` names the same trap).
    ...(committedCursor !== undefined ? { committedCursor } : {}),
    gaps: crawled.gaps.map((message) => coverageGap({ message })),
    notes: [
      ...crawled.notes,
      `${String(projected.records.length)} event record(s) projected — recurring series stored as their master, never expanded`,
      ...(anchored.line !== undefined ? [anchored.line] : []),
    ],
    projectedPerContainer: projected.records.length,
    records: [],
    warnings: [...crawled.warnings, ...projected.warnings, ...anchored.warnings],
  });
}

/**
 * Each calendar's next anchor: the instant this complete pass BEGAN reading it (`./fetch.ts` says why that and
 * never the newest stamp seen) — even when that is EARLIER than the stored one. The anchor only claims "every
 * edit before this was read", which an earlier instant still makes true; keeping a later stored one would
 * claim more than this pass read whenever this machine's clock stepped back between passes. Moving back costs only a re-read that dedup absorbs. A calendar this pass
 * did not read keeps its stored anchor. Pure.
 *
 * @param crawled the complete crawl
 * @param stored every anchor as it stood before this pass
 * @param recordedAtIso the instant to stamp on an anchor this pass moves
 * @returns every anchor as it should stand, and how many this pass moved
 */
export function advancedAnchors({
  crawled,
  stored,
  recordedAtIso,
}: {
  crawled: OutlookCalendarCrawlResult;
  stored: Readonly<Record<string, OutlookCalendarSyncAnchor>>;
  recordedAtIso: string;
}): { anchors: Readonly<Record<string, OutlookCalendarSyncAnchor>>; moved: number } {
  const anchors: Record<string, OutlookCalendarSyncAnchor> = { ...stored };
  for (const page of crawled.pages) {
    anchors[page.calendar.id] = { modifiedThroughIso: page.readStartedIso, recordedAtIso, version: 1 };
  }
  return { anchors, moved: crawled.pages.length };
}

/** Write the advanced anchors, unless a gap or a cap means this pass may not move any. */
function reanchor({
  crawled,
  home,
  nowIso,
}: {
  crawled: OutlookCalendarCrawlResult;
  home: string;
  nowIso: () => string;
}): { line: string | undefined; warnings: readonly string[] } {
  if (crawled.gaps.length > 0) {
    return {
      line: undefined,
      warnings: [
        "modified-time anchors were NOT advanced: this pass could not read every calendar, so the next one " +
          "asks the same question again rather than resuming past what it missed",
      ],
    };
  }
  if (crawled.capped) {
    return {
      line: undefined,
      warnings: [
        "modified-time anchors were NOT advanced: --sample/--fetch-cap stopped a calendar short, and an " +
          "anchor from a truncated read would skip every edit the cap left unread",
      ],
    };
  }
  const { anchors, moved } = advancedAnchors({
    crawled,
    recordedAtIso: nowIso(),
    stored: readOutlookCalendarSyncAnchors({ home }),
  });
  if (moved === 0) {
    return { line: undefined, warnings: [] };
  }
  const result = writeOutlookCalendarSyncAnchors({ anchors, home });
  if (result.isErr()) {
    return { line: undefined, warnings: result.error };
  }
  return { line: `modified-time anchor advanced for ${String(moved)} calendar(s)`, warnings: [] };
}
