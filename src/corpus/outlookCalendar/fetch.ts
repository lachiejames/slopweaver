/**
 * The `outlook-calendar` source's crawl — every calendar the Microsoft grant can see, every event STORED on it.
 *
 * ## Stored events, never a window's occurrences
 *
 * The crawl reads `/me/calendars/{id}/events`, which answers single events and series MASTERS, never the
 * occurrences a rule expands into. That is the Google lane's rule too (`../calendar/fetch.ts`): expansion is a
 * lossy projection, and bronze is the lossless capture. A window read (`calendarView`) is for a person asking
 * what is on this week; it is never what history is built from.
 *
 * ## Full history first, then what changed
 *
 * The owner's word on connecting a source is full history, then ongoing sync, never a hand-picked window. So
 * a calendar with no anchor is read WHOLE, whatever window `refresh` planned, and an explicit
 * `--since`/`--all` does the same: it overrides the anchor, and the only honest override for a source with
 * no time-bounded listing is the whole listing.
 *
 * A calendar WITH an anchor is read by `lastModifiedDateTime ge <anchor - overlap>`. Graph v1.0 has no
 * unbounded change feed for events (event `delta` there is `calendarView/delta`, tied to a fixed window and
 * the primary calendar; the unbounded one is beta), so a modified-time watermark is the incremental lane,
 * overlapped so an edit landing in the same instant as the last read is never skipped. Dedup absorbs the
 * overlap. Its stated residue: an event DELETED at Microsoft never shows up in a modified-time listing, so
 * its record stays in bronze until a full pass, and every incremental pass says so.
 *
 * ## The anchor is the instant the read BEGAN, never the newest stamp it saw
 *
 * A calendar's pages are read one after another, and Microsoft keeps editing while they are. Banking the
 * newest `lastModifiedDateTime` the pages returned would let an edit to an event on an ALREADY-READ page fall
 * behind a later page's newer stamp, and the next pass's filter would never ask for it again. So each calendar's read is fenced by this machine's clock taken before its
 * first page: every edit stamped after that instant is at or after the anchor, so the next pass asks for it,
 * and every edit before it either was on a page this pass read or falls inside the overlap. The overlap is
 * also what covers skew between this machine's clock and Microsoft's, up to its five minutes.
 *
 * ## One calendar failing is a gap, not a failed run
 *
 * The calendar LIST failing fails the run, because nothing else can be read. One calendar's events failing
 * is a coverage gap: the others still commit, and the gap holds every anchor (`./ingest.ts`), so the next
 * pass asks the same question again.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookError } from "../../live/outlook/errors.js";
import type { OutlookCalendarApi } from "../../live/outlookCalendar/api.js";
import { listOutlookCalendars, type OutlookCalendarSummary } from "../../live/outlookCalendar/read.js";
import type { GraphEvent } from "../../live/outlookCalendar/wire.js";
import type { OutlookCalendarSyncAnchors } from "./syncAnchor.js";

/** How many events one page asks for. Graph allows up to 1,000 on `/events`; 100 keeps a page's body small. */
const EVENT_PAGE_SIZE = 100;

/**
 * How far behind the anchor an incremental read starts, in milliseconds. Five minutes covers an edit that
 * landed in the same second as the last read and any skew between Microsoft's stamping and its listing.
 */
export const MODIFIED_OVERLAP_MS = 5 * 60 * 1000;

/** A caller's deliberate read bound, from `--sample`/`--fetch-cap`. */
export interface OutlookCalendarReadCap {
  /** The most events read from any one calendar. */
  readonly maxEvents: number;
}

/** How one calendar was read. */
type OutlookCalendarCrawlMode = "full" | "modified-since";

/** One calendar, read. */
interface OutlookCalendarCrawlPage {
  readonly calendar: OutlookCalendarSummary;
  readonly events: readonly GraphEvent[];
  readonly mode: OutlookCalendarCrawlMode;
  /** This machine's clock before the calendar's first page was asked for — what its anchor may advance to. */
  readonly readStartedIso: string;
}

/** What one crawl produced. */
export interface OutlookCalendarCrawlResult {
  readonly pages: readonly OutlookCalendarCrawlPage[];
  /** One line per calendar that could not be read; any gap holds every anchor. */
  readonly gaps: readonly string[];
  /** Whether a cap stopped any calendar short; a capped crawl holds every anchor. */
  readonly capped: boolean;
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * The instant an incremental read starts from: the anchor, less the overlap. Pure.
 *
 * @param anchors every stored anchor
 * @param calendarId the calendar being read
 * @param cursorOverridden whether the caller named an explicit window, which forces a full read
 * @returns the instant to filter from, or undefined when the calendar is read whole
 */
export function modifiedSinceFor({
  anchors,
  calendarId,
  cursorOverridden,
}: {
  anchors: OutlookCalendarSyncAnchors;
  calendarId: string;
  cursorOverridden: boolean;
}): string | undefined {
  if (cursorOverridden) {
    return undefined;
  }
  const anchor = anchors[calendarId];
  if (anchor === undefined) {
    return undefined;
  }
  const anchorMs = Date.parse(anchor.modifiedThroughIso);
  if (Number.isNaN(anchorMs)) {
    return undefined;
  }
  return new Date(anchorMs - MODIFIED_OVERLAP_MS).toISOString();
}

/** One calendar's events, every page, up to the cap. */
async function crawlOne({
  api,
  calendar,
  cap,
  modifiedSinceIso,
}: {
  api: OutlookCalendarApi;
  calendar: OutlookCalendarSummary;
  cap: OutlookCalendarReadCap | undefined;
  modifiedSinceIso: string | undefined;
}): Promise<Result<{ events: readonly GraphEvent[]; capped: boolean }, OutlookError>> {
  const events: GraphEvent[] = [];
  let link: string | undefined;
  for (;;) {
    const page = await api.listEvents(
      link === undefined ? { first: { calendarId: calendar.id, modifiedSinceIso, top: EVENT_PAGE_SIZE } } : { link },
    );
    if (page.isErr()) {
      return err(page.error);
    }
    events.push(...page.value.items);
    if (cap !== undefined && events.length >= cap.maxEvents) {
      const cutShort = events.length > cap.maxEvents || page.value.nextLink !== undefined;
      return ok({ capped: cutShort, events: events.slice(0, cap.maxEvents) });
    }
    if (page.value.nextLink === undefined) {
      return ok({ capped: false, events });
    }
    link = page.value.nextLink;
  }
}

/**
 * Crawl every calendar the grant can see.
 *
 * @param api the calendar seam
 * @param anchors every stored anchor, which decides full or incremental per calendar
 * @param cap the caller's deliberate read bound, when given
 * @param cursorOverridden whether an explicit window was named, which reads every calendar whole
 * @param nowIso this machine's clock, read once before each calendar's first page to fence its anchor
 * @returns the calendars read, the gaps, and whether a cap bit; or why not even the calendar list could be read
 */
export async function crawlOutlookCalendars({
  api,
  anchors,
  cap,
  cursorOverridden,
  nowIso,
}: {
  api: OutlookCalendarApi;
  anchors: OutlookCalendarSyncAnchors;
  cap: OutlookCalendarReadCap | undefined;
  cursorOverridden: boolean;
  nowIso: () => string;
}): Promise<Result<OutlookCalendarCrawlResult, OutlookError>> {
  const calendars = await listOutlookCalendars({ api });
  if (calendars.isErr()) {
    return err(calendars.error);
  }
  const pages: OutlookCalendarCrawlPage[] = [];
  const gaps: string[] = [];
  let capped = false;
  let incremental = 0;
  for (const calendar of calendars.value) {
    const modifiedSinceIso = modifiedSinceFor({ anchors, calendarId: calendar.id, cursorOverridden });
    // Taken BEFORE the first page, so no edit made while the pages are read can sit behind it.
    const readStartedIso = nowIso();
    const read = await crawlOne({ api, calendar, cap, modifiedSinceIso });
    if (read.isErr()) {
      gaps.push(`calendar ${calendar.id} could not be read: ${read.error.message}`);
      continue;
    }
    capped = capped || read.value.capped;
    if (modifiedSinceIso !== undefined) {
      incremental += 1;
    }
    pages.push({
      calendar,
      events: read.value.events,
      mode: modifiedSinceIso === undefined ? "full" : "modified-since",
      readStartedIso,
    });
  }
  return ok({
    capped,
    gaps,
    notes: crawlNotes({ calendars: calendars.value.length, incremental }),
    pages,
    warnings: [],
  });
}

/**
 * The note lines a crawl prints about how it read. Pure.
 *
 * @param calendars how many calendars the grant could see
 * @param incremental how many of them were read by modified time rather than whole
 * @returns the note lines
 */
export function crawlNotes({ calendars, incremental }: { calendars: number; incremental: number }): readonly string[] {
  const whole = calendars - incremental;
  return [
    `${String(calendars)} calendar(s): ${String(whole)} read whole, ${String(incremental)} read by what changed since the last pass`,
    ...(incremental > 0
      ? [
          "an event deleted at Microsoft is not in a changed-since listing, so its record stays until a full pass (`refresh --source outlook-calendar --all`)",
        ]
      : []),
  ];
}
