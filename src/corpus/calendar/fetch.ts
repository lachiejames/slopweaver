/**
 * The `calendar` crawl — two lanes over the same seam, and the rules that decide which one runs.
 *
 * ## Delta or window, per calendar
 *
 * A calendar with a usable stored `syncToken` takes the DELTA lane: Google serves only what changed, which
 * includes an event edited today that moved a meeting held last month. A time-ordered cursor would never
 * see that edit, which is the whole reason this source carries a second cursor layer at all.
 *
 * Every other calendar takes the WINDOW lane, bounded by the planned export window. A calendar arrives here
 * without a token for three reasons that the crawl deliberately does not distinguish: it has never been
 * anchored, the caller named an explicit window, or its stored token was minted under different parameters.
 * A fourth reason is decided mid-pass: a token Google has INVALIDATED (a 410, typed `SYNC_TOKEN_EXPIRED`)
 * sends that one calendar down the window lane immediately, in the same pass, and its page re-anchors
 * normally — see {@link recoverExpired} for why a gap there stalled the whole diary permanently.
 *
 * Both of the window lane's bounds are RFC 3339 instants in ascending order, whatever the planner supplied:
 * {@link windowBounds}. A bare day bound is Google's `400 Bad Request`; a REVERSED pair is worse, because
 * Google accepts it and answers with an empty listing. This source's own cursor can sit in the future, so
 * both shapes were reachable from ordinary state.
 *
 * ## `singleEvents: false`, and why that is the data-integrity choice
 *
 * Bronze stores the recurring MASTER carrying its rule, plus any instance that was individually changed.
 * Expansion is a projection, and a projection made once at write time is a decision nobody can revisit: an
 * unbounded expansion of a daily standup is thousands of near-identical records for one commitment, and a
 * BOUNDED one silently defines "the calendar" as whatever window happened to be planned that day. The door
 * expands, because a human asking what is on means instances. The corpus does not.
 *
 * ## `showDeleted: true`, and why a cancellation is a record
 *
 * A cancelled event is not an absent event. "The review was called off" is a fact about what happened, and
 * a crawl that dropped cancellations would leave bronze asserting a meeting took place. Google reports them
 * with `status: "cancelled"`, the projection keeps them, and a reader is told.
 */
import { createHash } from "node:crypto";

import type { calendar_v3 } from "@googleapis/calendar";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type CalendarApi, type CalendarSummary, walkEventPages } from "../../live/calendar/api.js";
import type { CalendarError } from "../../live/calendar/errors.js";
import type { ExportWindow } from "../types.js";
import { type CalendarSyncAnchors, resumableToken } from "./syncAnchor.js";

/**
 * A planned window bound as Google's `events.list` will accept it — an RFC 3339 instant, never a bare day.
 *
 * The refresh planner hands this lane `YYYY-MM-DD` bounds (a watermark cursor can be a full instant, a
 * fallback never is), and Google answers a bare date on `timeMin`/`timeMax` with `400 Bad Request`. MEASURED:
 * `slopweaver refresh --source calendar` read 0 of 2 calendars, both `Bad Request`, on every
 * scheduled pass with a bare day — the one source that never committed a row. The door's own
 * reader (`cli/commands/calendar/core.ts`) always sent `toISOString()`; this lane now does too. A day bound is
 * UTC midnight, the same reading `parseYyyyMmDdUtcMs` gives it. Pure.
 *
 * @param bound the planned bound, a `YYYY-MM-DD` day or an ISO instant
 * @returns the same bound as an RFC 3339 instant; an unparseable bound passes through untouched so Google
 *   names it in its own refusal rather than this lane inventing a window
 */
export function rfc3339Bound({ bound }: { bound: string }): string {
  const ms = parseIsoMs({ tsIso: bound });
  if (ms === undefined) {
    return bound;
  }
  return new Date(ms).toISOString();
}

/**
 * The window lane's bounds as Google will accept them — ordered, whatever order the planner supplied.
 *
 * A calendar record's `tsIso` is the event's START, so this source's pooled cursor can sit in the FUTURE:
 * a watermark can read a future instant while `until` is today, which plans `since`
 * a year AFTER `until`. {@link ../ingest.pooledCursor} stops that value being minted again; this stops an
 * already-stored one reaching the wire, because `../watermark.ts` merges MAX and a cursor on disk can never
 * be lowered by a later run.
 *
 * **Google does not refuse an inverted pair — it answers it with silence**, which is why this is a bug
 * rather than an error message. MEASURED, with a `--since` a year past today:
 *
 * ```
 * slopweaver refresh --source calendar --since <a day a year ahead> --sample 1   # planned window: since after until
 * ```
 *
 * Without this function, that read "2 of 2 calendar(s)", projected ZERO events, and then
 * ADVANCED both sync tokens from the empty crawl — a pass that saw nothing, reported success, and
 * re-anchored on it. With the bounds ordered, the same command projects real records.
 *
 * An inverted pair still names a real span — today through the furthest instant the cursor claims — so the
 * bounds are SWAPPED rather than collapsed to an empty window, which is the silent-zero shape above. The
 * swap is reported, never silent: {@link crawlCalendars} warns whenever `inverted` is true. Pure.
 *
 * @param window the planned export window, whose bounds may be days, instants, or the wrong way round
 * @returns the RFC 3339 pair to send, and whether they had to be reordered to get there
 */
export function windowBounds({ window }: { window: ExportWindow }): {
  timeMinIso: string;
  timeMaxIso: string;
  inverted: boolean;
} {
  const since = rfc3339Bound({ bound: window.since });
  const until = rfc3339Bound({ bound: window.until });
  if (since > until) {
    return { inverted: true, timeMaxIso: since, timeMinIso: until };
  }
  return { inverted: false, timeMaxIso: until, timeMinIso: since };
}

/** How many events one page asks Google for. Google's own maximum for `events.list` is 2500. */
const PAGE_SIZE = 250;

/** The ceiling on events gathered from ONE calendar in one pass, absent a caller's own cap. */
const MAX_EVENTS_PER_CALENDAR = 5_000;

/** A caller's deliberate read bound, from `--sample` or `--fetch-cap`. */
export interface CalendarReadCap {
  readonly maxEvents: number;
}

/** What one calendar's crawl produced. */
export interface CalendarCrawlPage {
  readonly calendar: CalendarSummary;
  readonly events: readonly calendar_v3.Schema$Event[];
  /** `delta` when a stored token was resumed, `window` when the planned window was crawled. */
  readonly lane: "delta" | "window";
  /** The token to store, present only when this calendar was read to its end. */
  readonly nextSyncToken: string | undefined;
}

/** What the whole crawl produced, plus everything it could not cover. */
export interface CalendarCrawlResult {
  readonly pages: readonly CalendarCrawlPage[];
  readonly warnings: readonly string[];
  readonly gaps: readonly string[];
  readonly notes: readonly string[];
  /** Whether a caller-supplied cap stopped any calendar short, which withholds every anchor. */
  readonly capped: boolean;
}

/**
 * The digest of the request parameters a stored token must have been minted under.
 *
 * Google's contract is that an incremental request repeats its token's parameters, and that results are
 * UNDEFINED otherwise. Undefined is worse than an error, because it is silently missing events — so the
 * fingerprint is stored beside the token and compared before the token is ever sent. Pure.
 *
 * @param singleEvents whether the listing expands recurring events
 * @param showDeleted whether the listing reports cancellations
 * @returns a stable digest of exactly the parameters that bind a token
 */
export function parameterFingerprint({
  singleEvents,
  showDeleted,
}: {
  singleEvents: boolean;
  showDeleted: boolean;
}): string {
  return createHash("sha256")
    .update(`singleEvents=${String(singleEvents)};showDeleted=${String(showDeleted)}`)
    .digest("hex")
    .slice(0, 16);
}

/** The per-calendar event ceiling this pass applies. */
function ceilingFor({ cap }: { cap: CalendarReadCap | undefined }): number {
  return cap === undefined ? MAX_EVENTS_PER_CALENDAR : Math.min(cap.maxEvents, MAX_EVENTS_PER_CALENDAR);
}

/**
 * Crawl one calendar, taking the delta lane when its stored token is usable and the window lane otherwise.
 *
 * @param api the injected Calendar seam
 * @param calendar the calendar being read
 * @param token the resumable sync token, or undefined to crawl the window
 * @param window the planned export window, used only by the window lane
 * @param ceiling how many events this pass may gather from this calendar
 * @returns the page, or the typed reason the crawl failed
 */
async function crawlOne({
  api,
  calendar,
  token,
  window,
  ceiling,
}: {
  api: CalendarApi;
  calendar: CalendarSummary;
  token: string | undefined;
  window: ExportWindow;
  ceiling: number;
}): Promise<Result<CalendarCrawlPage, CalendarError>> {
  const bounds = windowBounds({ window });
  const walked = await walkEventPages({
    fetchPage: ({ pageToken, limit }) =>
      api.listEvents({
        calendarId: calendar.id,
        limit,
        pageToken,
        showDeleted: true,
        singleEvents: false,
        ...(token !== undefined
          ? { syncToken: token }
          : { timeMaxIso: bounds.timeMaxIso, timeMinIso: bounds.timeMinIso }),
      }),
    maxItems: ceiling,
    pageSize: PAGE_SIZE,
  });
  if (walked.isErr()) {
    return err(walked.error);
  }
  return ok({
    calendar,
    events: walked.value.events,
    lane: token === undefined ? "window" : "delta",
    // Withheld unless the walk reached the end. A token from a truncated walk would claim everything before
    // it had been served, and the next delta pass would resume past exactly what this one skipped.
    nextSyncToken: walked.value.complete ? walked.value.syncToken : undefined,
  });
}

/**
 * A crawl that failed on an EXPIRED sync token, crawled again by window — every other outcome untouched.
 *
 * Google invalidates a sync token whenever its retention or the request's parameters change, and answers a
 * call carrying a dead one with a 410 that `../../live/calendar/api.ts` types as `SYNC_TOKEN_EXPIRED`
 * precisely so this lane can re-crawl and re-anchor. Nothing consumed that distinction before: the expiry
 * became a gap, a gap withholds EVERY anchor, and the next pass sent the same dead token — so the diary
 * stopped updating and no pass ever recovered it.
 *
 * The retry is the WINDOW lane, which is exactly what a calendar with no usable token takes anyway, so its
 * page re-anchors through the ordinary path with no second write.
 *
 * @param crawled what the first attempt produced
 * @param api the injected Calendar seam
 * @param calendar the calendar being read
 * @param window the planned export window the retry crawls
 * @param ceiling how many events this pass may gather from this calendar
 * @returns the original result unless a token expired, in which case the window crawl that replaced it
 */
async function recoverExpired({
  crawled,
  api,
  calendar,
  window,
  ceiling,
}: {
  crawled: Result<CalendarCrawlPage, CalendarError>;
  api: CalendarApi;
  calendar: CalendarSummary;
  window: ExportWindow;
  ceiling: number;
}): Promise<Result<CalendarCrawlPage, CalendarError>> {
  if (crawled.isOk() || crawled.error.code !== "SYNC_TOKEN_EXPIRED") {
    return crawled;
  }
  return crawlOne({ api, calendar, ceiling, token: undefined, window });
}

/**
 * Crawl every calendar the grant can see.
 *
 * A calendar that fails is a WARNING and a GAP rather than a failure of the whole run: one team calendar
 * the grant lost access to must not cost the owner their own diary. A gap withholds every anchor, so the
 * next pass asks the same question again.
 *
 * @param api the injected Calendar seam
 * @param window the planned export window
 * @param anchors every stored sync token
 * @param cap the caller's deliberate read bound, when `--sample`/`--fetch-cap` set one
 * @param cursorOverridden whether an explicit window flag beat the stored anchors
 * @returns everything the crawl gathered and everything it could not cover
 */
export async function crawlCalendars({
  api,
  window,
  anchors,
  cap,
  cursorOverridden,
}: {
  api: CalendarApi;
  window: ExportWindow;
  anchors: CalendarSyncAnchors;
  cap: CalendarReadCap | undefined;
  cursorOverridden: boolean;
}): Promise<Result<CalendarCrawlResult, CalendarError>> {
  const listed = await api.listCalendars({});
  if (listed.isErr()) {
    return err(listed.error);
  }
  const fingerprint = parameterFingerprint({ showDeleted: true, singleEvents: false });
  const ceiling = ceilingFor({ cap });
  const pages: CalendarCrawlPage[] = [];
  const warnings: string[] = [];
  const gaps: string[] = [];
  let capped = false;
  for (const calendar of listed.value.calendars) {
    const token = cursorOverridden ? undefined : resumableToken({ anchors, calendarId: calendar.id, fingerprint });
    const crawled = await crawlOne({ api, calendar, ceiling, token, window });
    const recovered = await recoverExpired({ api, calendar, ceiling, crawled, window });
    if (recovered.isErr()) {
      warnings.push(`calendar ${calendar.id}: ${recovered.error.message}`);
      gaps.push(`calendar ${calendar.id} could not be read this pass`);
      continue;
    }
    if (crawled.isErr()) {
      warnings.push(
        `calendar ${calendar.id}: ${crawled.error.message} — this pass re-crawled its window and re-anchored it`,
      );
    }
    if (recovered.value.events.length >= ceiling) {
      capped = true;
    }
    pages.push(recovered.value);
  }
  // Only when a calendar really took the window lane: a pass where every calendar resumed by token sent no
  // bounds at all, and a warning about bounds nobody sent is noise an operator would have to rule out.
  if (windowBounds({ window }).inverted && pages.some((page) => page.lane === "window")) {
    warnings.push(
      `the planned window ran backwards (${window.since} after ${window.until}), so the window lane sent its ` +
        "bounds in the order Google accepts rather than the order it was handed — a stored cursor ahead of " +
        "today is what produces this, and Google answers a reversed pair with an empty listing rather than " +
        "an error",
    );
  }
  return ok({
    capped,
    gaps,
    notes: crawlNotes({ cursorOverridden, listed: listed.value.calendars.length, pages }),
    pages,
    warnings,
  });
}

/**
 * The note lines the run prints about this lane.
 *
 * The lane each calendar took is named, because "delta" and "window" have different costs and different
 * coverage and an operator cannot tell them apart from the record counts alone — a quiet week and a
 * discarded token both look like a handful of events.
 *
 * @param pages what each calendar produced
 * @param listed how many calendars the grant could see
 * @param cursorOverridden whether an explicit window beat every stored anchor
 * @returns the note lines, in print order
 */
export function crawlNotes({
  pages,
  listed,
  cursorOverridden,
}: {
  pages: readonly CalendarCrawlPage[];
  listed: number;
  cursorOverridden: boolean;
}): readonly string[] {
  const delta = pages.filter((page) => page.lane === "delta").length;
  return [
    `${String(pages.length)} of ${String(listed)} calendar(s) read · ${String(delta)} by delta, ` +
      `${String(pages.length - delta)} by window`,
    ...(cursorOverridden
      ? ["an explicit window was named, so every stored sync token was ignored and every calendar re-crawled"]
      : []),
  ];
}
