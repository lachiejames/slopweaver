/**
 * The `calendar` source's ingest job — crawl, project, commit, then re-anchor, wrapped in the ONE
 * per-source seam ({@link ../ingestJob.SourceIngestJob}) so the diary flows through the same redact,
 * dedup and JSONL write, the same pooled watermark and the same run summary as every other source.
 * Deliberately not a second door into bronze: `refresh` stays the only writer.
 *
 * ## The anchor is written AFTER the write, and only when the cursor is allowed to move
 *
 * The per-calendar `syncToken` is a second cursor layer, so it obeys the rule the pooled one does: a run
 * that did not see its whole window must not move it. The two are advanced by different code —
 * {@link ../ingestSource.ingestSources} owns the pooled cursor and this file owns the tokens — so the rule
 * is restated here rather than inherited, and the shape of the restatement is what keeps it honest:
 *
 *  - a crawl reporting a COVERAGE GAP re-anchors NOTHING, so the next pass asks the same question again;
 *  - a crawl whose write FAILED re-anchors nothing, because the events it read are not on disk;
 *  - a CAPPED run (`--sample`/`--fetch-cap`) re-anchors nothing either, and this is the one the shared
 *    machinery cannot do for us. `ingestSources` holds the POOLED cursor for a capped run but has never
 *    heard of a sync token — so without the explicit branch in {@link reanchor}, `--sample 3` would anchor
 *    as though it had ingested every calendar and every later run would resume past what it skipped.
 *
 * The failure this prevents is the expensive one and it has a name here: a cursor that moved past data the
 * API really has, with the run reporting success and nothing recording that a gap existed.
 *
 * ## Why it commits before it anchors rather than the other way round
 *
 * Anchoring first and writing second would, on a crash between them, lose the events AND claim they were
 * seen. Writing first and anchoring second loses only the anchor, and the recovery for a missing anchor is
 * one window crawl whose records all dedup away. The asymmetry decides the order.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type CalendarApi, type CalendarSummary, makeCalendarApi } from "../../live/calendar/api.js";
import { resolveCalendarClient } from "../../live/calendar/client.js";
import { type ParsedCalendarEvent, parseCalendarEvent } from "../../live/calendar/parse.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import { newestTsAtClock } from "../newestTs.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { type CalendarCrawlResult, type CalendarReadCap, crawlCalendars, parameterFingerprint } from "./fetch.js";
import { projectCalendarEvents } from "./project.js";
import { type CalendarSyncAnchor, readCalendarSyncAnchors, writeCalendarSyncAnchor } from "./syncAnchor.js";

/**
 * The read bound a `--sample`/`--fetch-cap` run puts on this lane, when either was given.
 *
 * Both flags collapse to one per-calendar number here. `--sample` caps records per container after the
 * fetch and `--fetch-cap` caps the fetch per lane; a calendar IS a container, so the two mean the same
 * thing on this source. The TIGHTER of the two wins, so passing both never widens either. Pure.
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
}): CalendarReadCap | undefined {
  const bounds = [sample, fetchCap].filter((value): value is number => value !== undefined);
  return bounds.length === 0 ? undefined : { maxEvents: Math.min(...bounds) };
}

/**
 * Build the `calendar` ingest job.
 *
 * The API seam is injectable so the job's ORDERING — commit, then anchor, and neither when the crawl
 * reported a gap — is testable without a Google account. In production it resolves the stored grant, which
 * is also where a missing grant or a too-narrow one is refused by name.
 *
 * @param home the Slopweaver home holding the grant, the bronze store and the anchors
 * @param window the planned export window, used by the window lane and to name the bronze file
 * @param nowIso the clock, for each anchor's recorded time
 * @param api the Calendar seam; omitted in production, where the stored grant resolves one
 * @param sample the `--sample` cap, which bounds this lane's own commit and HOLDS its anchors
 * @param fetchCap the `--fetch-cap` cap, same effect — see {@link readCap}
 * @param cursorOverridden whether the caller named an explicit window (`--since`/`--all`/`--lookback-days`),
 *   which must beat every stored token exactly as it already beats every other source's cursor
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function calendarIngestJob({
  home,
  window,
  nowIso,
  api,
  sample,
  fetchCap,
  cursorOverridden = false,
}: {
  home: string;
  window: ExportWindow;
  nowIso: () => string;
  api?: CalendarApi;
  sample?: number;
  fetchCap?: number;
  cursorOverridden?: boolean;
}): SourceIngestJob {
  const cap = readCap({ fetchCap, sample });
  return {
    label: "calendar (diary)",
    run: () => runCalendarIngest({ api, cap, cursorOverridden, home, nowIso, window }),
    source: "calendar",
    window,
  };
}

/** What one calendar ingest pass reports back through the shared per-source seam. */
type CalendarIngestOutcome = Result<{
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
 * @param home the Slopweaver home
 * @param window the planned export window
 * @param nowIso the clock
 * @param api the injected Calendar seam, when a caller supplied one
 * @param cap the caller's deliberate read bound
 * @param cursorOverridden whether an explicit window was named, which makes the lane ignore every token
 * @returns what the pass wrote and what it could not cover
 */
async function runCalendarIngest({
  api,
  cap,
  cursorOverridden,
  home,
  nowIso,
  window,
}: {
  api: CalendarApi | undefined;
  cap: CalendarReadCap | undefined;
  cursorOverridden: boolean;
  home: string;
  nowIso: () => string;
  window: ExportWindow;
}): Promise<CalendarIngestOutcome> {
  const resolved = resolveApi({ api, home });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const crawled = await crawlCalendars({
    anchors: readCalendarSyncAnchors({ home }),
    api: resolved.value,
    cap,
    cursorOverridden,
    window,
  });
  if (crawled.isErr()) {
    return err([crawled.error.message]);
  }
  return commitCrawl({ crawled: crawled.value, home, nowIso, window });
}

/**
 * Resolve the production seam from the stored grant.
 *
 * @param api the injected seam, when a caller supplied one
 * @param home the Slopweaver home holding the grant
 * @returns the seam, or the reason no grant could authorise one
 */
function resolveApi({ api, home }: { api: CalendarApi | undefined; home: string }): Result<CalendarApi> {
  if (api !== undefined) {
    return ok(api);
  }
  // `events` alone, deliberately: this lane reads events from every calendar it is handed, and the
  // calendar LIST it needs is satisfied by `calendar.readonly`, which implies the events scope. Asking for
  // `calendars` here would make a `--grant events` install fail with a scope message naming a scope the
  // ingest could not use anyway.
  const bound = resolveCalendarClient({ capabilities: ["calendars"], home });
  if (bound.isErr()) {
    return err([bound.error.message]);
  }
  return ok(makeCalendarApi({ account: bound.value.account, client: bound.value.client }));
}

/** Every crawled event, parsed and paired with the calendar it came from. */
function parseCrawl({ crawled }: { crawled: CalendarCrawlResult }): readonly {
  readonly event: ParsedCalendarEvent;
  readonly calendar: CalendarSummary;
}[] {
  return crawled.pages.flatMap((page) =>
    page.events
      .map((raw) => parseCalendarEvent({ calendarId: page.calendar.id, event: raw }))
      .filter((event): event is ParsedCalendarEvent => event !== undefined)
      .map((event) => ({ calendar: page.calendar, event })),
  );
}

/**
 * The pooled cursor this pass may bank — the newest record it wrote, never later than the clock.
 *
 * The pooled watermark answers how far through TIME a source has been read (`../watermark.ts`). Every other
 * source's newest record is in the past, so its newest `tsIso` answers that question directly. A calendar
 * record's `tsIso` is the event's START, so a diary read to its end still hands back a meeting months ahead
 * — and banking that claims a year nobody has read. MEASURED: an operator's
 * `corpus/watermarks/calendar.json` held an instant a year ahead, so every pass planned a window
 * whose since sat a year after until (`slopweaver refresh --source calendar` prints the
 * planned window it used). A window-lane pass on those bounds reads NOTHING and reports success, because
 * Google accepts a reversed pair rather than refusing it. Watermark merge is MAX, so a cursor that reaches
 * disk can never be lowered — {@link ./fetch.windowBounds} is the other half of the fix. Pure.
 *
 * @param records what this pass committed
 * @param nowIso the instant this pass ran, which is as far through time as reading a diary can prove
 * @returns the cursor to bank, or undefined when this pass committed nothing
 */
export function pooledCursor({
  records,
  nowIso,
}: {
  records: readonly CorpusRecord[];
  nowIso: string;
}): string | undefined {
  return newestTsAtClock({ nowIso, records });
}

/**
 * Project and commit a completed crawl, then re-anchor — never the other way round.
 *
 * The records are committed HERE rather than handed to the bulk write, so the anchors are only ever written
 * after the events they claim to cover are on disk. The bulk write is then handed nothing, which is why
 * both per-container counts are reported.
 *
 * @param crawled what the crawl produced
 * @param home the Slopweaver home
 * @param window the export window, which names the bronze file
 * @param nowIso the clock
 * @returns the pass outcome, or the write failure that stopped it before anything was anchored
 */
function commitCrawl({
  crawled,
  home,
  window,
  nowIso,
}: {
  crawled: CalendarCrawlResult;
  home: string;
  window: ExportWindow;
  nowIso: () => string;
}): CalendarIngestOutcome {
  const projected = projectCalendarEvents({ events: parseCrawl({ crawled }) });
  const written = createBronzeCommitter({ home, window }).commit({ records: projected.records });
  if (written.isErr()) {
    return err(written.error);
  }
  const anchored = reanchor({ crawled, home, nowIso });
  const committedCursor = pooledCursor({ nowIso: nowIso(), records: projected.records });
  return ok({
    committedPerContainer: written.value.written,
    // Without this the POOLED cursor never moves at all, and the reason is worth stating because it is not
    // obvious: this lane commits its own records and hands the bulk write an empty list, so
    // `computeSourceWatermarks` sees no records for `calendar` and returns nothing to advance. Every run
    // would then re-plan the same window while its own log line claimed a resume that never happened.
    ...(committedCursor !== undefined ? { committedCursor } : {}),
    gaps: crawled.gaps.map((message) => coverageGap({ message })),
    notes: [...crawled.notes, ...ingestNotes({ anchored: anchored.line, projected: projected.records.length })],
    projectedPerContainer: projected.records.length,
    records: [],
    warnings: [...crawled.warnings, ...projected.warnings, ...anchored.warnings],
  });
}

/**
 * The note lines this lane prints about what it wrote.
 *
 * @param projected how many records the projection produced
 * @param anchored the anchor line, when tokens were written
 * @returns the note lines, in print order
 */
export function ingestNotes({
  projected,
  anchored,
}: {
  projected: number;
  anchored: string | undefined;
}): readonly string[] {
  return [
    `${String(projected)} event record(s) projected — recurring series stored as their master, never expanded`,
    ...(anchored !== undefined ? [anchored] : []),
  ];
}

/**
 * Write the new sync tokens, unless this run is not entitled to move a cursor.
 *
 * ALL-or-nothing across calendars, deliberately. A gap on one calendar withholds every token, because the
 * alternative is a corpus where some calendars resumed and others did not, and no single later run could
 * tell which. One extra window crawl is cheap; a partially-resumed diary is not diagnosable.
 *
 * @param crawled what the crawl produced, including its gaps and whether a cap bit
 * @param home the Slopweaver home
 * @param nowIso the clock
 * @returns the note line to print when tokens were written, and any warning from failing to
 */
function reanchor({ crawled, home, nowIso }: { crawled: CalendarCrawlResult; home: string; nowIso: () => string }): {
  line: string | undefined;
  warnings: readonly string[];
} {
  if (crawled.gaps.length > 0) {
    return {
      line: undefined,
      warnings: [
        "sync tokens were NOT advanced: this pass could not read every calendar, so the next one asks the " +
          "same question again rather than resuming past what it missed",
      ],
    };
  }
  if (crawled.capped) {
    return {
      line: undefined,
      warnings: [
        "sync tokens were NOT advanced: --sample/--fetch-cap stopped a calendar short, and a token from a " +
          "truncated read would claim everything before it had been served",
      ],
    };
  }
  const fingerprint = parameterFingerprint({ showDeleted: true, singleEvents: false });
  const anchors: Record<string, CalendarSyncAnchor> = { ...readCalendarSyncAnchors({ home }) };
  let written = 0;
  for (const page of crawled.pages) {
    if (page.nextSyncToken === undefined) {
      continue;
    }
    anchors[page.calendar.id] = {
      parameterFingerprint: fingerprint,
      recordedAtIso: nowIso(),
      syncToken: page.nextSyncToken,
    };
    written += 1;
  }
  if (written === 0) {
    return { line: undefined, warnings: [] };
  }
  const result = writeCalendarSyncAnchor({ anchors, home });
  if (result.isErr()) {
    return { line: undefined, warnings: result.error };
  }
  return { line: `sync token advanced for ${String(written)} calendar(s)`, warnings: [] };
}
