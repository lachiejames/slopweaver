/**
 * The `fathom` crawl: page the meeting list from the window's start, newest cursor onward, carrying each
 * page's transcripts with it.
 *
 * ## One heavy request per PAGE, not per recording
 *
 * Fathom meters `include_transcript` under its heavy class — 30 calls a minute, and "during periods of
 * elevated activity this limit may be adjusted down to 5 every 60 seconds"
 * (`https://developers.fathom.ai/api-overview`). Asking `/meetings` for transcripts inline spends ONE heavy
 * request per page of meetings; walking the list and then calling `/recordings/<id>/transcript` per row
 * spends one per meeting, which at the degraded limit is a minute of waiting for every five calls
 * ingested. The list-with-transcripts shape is the whole reason this lane has no second call.
 *
 * ## The cursor is `created_at`, and the record's instant is not
 *
 * `/meetings` filters and pages on `created_at` — when Fathom finished PROCESSING the call — so that is
 * what the window's `since` is passed as and what pagination resumes from. A record is dated by its
 * RECORDING START instead (`./project.ts` says why), and the two genuinely differ: a call whose processing
 * is delayed is created the following day, which is the exact case this lane was built for.
 *
 * The consequence is stated rather than left to be discovered: a window expressed in `created_at` can
 * return a meeting whose recording start is BEFORE the window. That is correct and deliberate — it is the
 * delayed call arriving — and nothing here filters it out on the recording instant.
 *
 * ## A page that fails is a GAP, never a silent stop
 *
 * A crawl that gave up halfway and reported success would move the pooled cursor past meetings the API
 * really has. Every failure path here returns a coverage gap, and `./ingest.ts` withholds the cursor on
 * one.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { FathomApi } from "../../live/fathom/api.js";
import { isUnauthorised } from "../../live/fathom/api.js";
import type { ExportWindow } from "../types.js";
import { type FathomError, FathomErrors } from "./errors.js";
import type { FathomMeeting } from "./types.js";

/**
 * The most pages one crawl walks.
 *
 * A hard stop rather than a trust in `next_cursor` eventually being null: a provider that keeps handing
 * back a cursor would otherwise loop forever inside one refresh. At {@link ../../live/fathom/api.FATHOM_PAGE_SIZE}
 * meetings a page this covers 5,000 calls in one pass, which is more than this account has ever recorded —
 * and a run that reaches it reports a GAP rather than declaring the window covered.
 */
export const MAX_PAGES = 500;

/** What one crawl saw, and what it could not. */
export interface FathomCrawlResult {
  readonly meetings: readonly FathomMeeting[];
  readonly warnings: readonly string[];
  /** Non-empty ⇒ the crawl did not cover its window and the cursor must NOT move. */
  readonly gaps: readonly string[];
  /** How many pages were walked — the number a reader checks a `--fetch-cap` against. */
  readonly pages: number;
}

/** The bound a `--sample`/`--fetch-cap` run puts on this lane. */
export interface FathomReadCap {
  readonly maxMeetings: number;
}

/** What a crawl has accumulated so far. Mutated in place by the loop; never escapes this module. */
interface CrawlState {
  readonly meetings: FathomMeeting[];
  readonly warnings: string[];
  pages: number;
}

/**
 * The window as Fathom's own `created_at` filter spells it, computed once rather than per page.
 *
 * @param window the planned export window
 * @returns the filter fields the provider carries, each present only when the window carried a bound
 * @internal
 */
function windowFilter({ window }: { window: ExportWindow }): { createdAfter?: string; createdBefore?: string } {
  const since = isoBound({ date: window.since });
  const until = isoBound({ date: window.until });
  return {
    ...(since !== undefined ? { createdAfter: since } : {}),
    ...(until !== undefined ? { createdBefore: until } : {}),
  };
}

/**
 * Whether this page ENDS the crawl, and with what.
 *
 * The two terminal states are opposites and it matters that they are told apart: an exhausted cursor means
 * the window was covered and the pooled watermark may move, while a cap means the run was deliberately
 * bounded and the watermark must be held.
 *
 * @param cap the read bound, when the run is capped
 * @param nextCursor the cursor this page handed back, absent when it was the last
 * @param state what has accumulated so far
 * @returns the finished crawl, or undefined when there is another page to ask for
 * @internal
 */
function terminalCrawl({
  cap,
  nextCursor,
  state,
}: {
  cap: FathomReadCap | undefined;
  nextCursor: string | undefined;
  state: CrawlState;
}): FathomCrawlResult | undefined {
  if (cap !== undefined && state.meetings.length >= cap.maxMeetings) {
    return {
      gaps: [],
      meetings: state.meetings.slice(0, cap.maxMeetings),
      pages: state.pages,
      warnings: [
        ...state.warnings,
        `fathom: stopped at the ${String(cap.maxMeetings)}-meeting cap — this run is bounded, so its cursor is held`,
      ],
    };
  }
  if (nextCursor === undefined) {
    return { gaps: [], meetings: state.meetings, pages: state.pages, warnings: state.warnings };
  }
  return undefined;
}

/**
 * A crawl that read some pages and then could not read another.
 *
 * A LATER page failing is a partial crawl, not a dead lane: what already arrived is worth committing, and
 * the gap is what stops the cursor moving past what was never read.
 *
 * @param message the boundary failure's own message
 * @param state what had accumulated when it failed
 * @returns the partial crawl, carrying its gap
 * @internal
 */
function partialCrawl({ message, state }: { message: string; state: CrawlState }): FathomCrawlResult {
  return {
    gaps: [`fathom: page ${String(state.pages + 1)} failed (${message}) — the window is NOT covered`],
    meetings: state.meetings,
    pages: state.pages,
    warnings: state.warnings,
  };
}

/**
 * Crawl the meetings created inside a window.
 *
 * @param api the provider seam
 * @param window the planned export window, whose bounds are passed as `created_after`/`created_before`
 * @param cap the read bound a capped run imposes, when either cap flag was given
 * @returns everything the crawl saw plus any gap, or a typed failure when the very first page refused
 */
export async function crawlFathomMeetings({
  api,
  window,
  cap,
}: {
  api: FathomApi;
  window: ExportWindow;
  cap?: FathomReadCap;
}): Promise<Result<FathomCrawlResult, FathomError>> {
  const filter = windowFilter({ window });
  const state: CrawlState = { meetings: [], pages: 0, warnings: [] };
  let cursor: string | undefined;
  while (state.pages < MAX_PAGES) {
    const page = await api.listMeetings({ ...filter, ...(cursor !== undefined ? { cursor } : {}) });
    if (page.isErr()) {
      return state.pages === 0
        ? err(firstPageFailure({ error: page.error }))
        : ok(partialCrawl({ message: page.error.message, state }));
    }
    state.pages += 1;
    state.meetings.push(...page.value.meetings);
    const finished = terminalCrawl({ cap, nextCursor: page.value.nextCursor, state });
    if (finished !== undefined) {
      return ok(finished);
    }
    cursor = page.value.nextCursor;
  }
  return ok({
    gaps: [`fathom: stopped after ${String(MAX_PAGES)} pages with a cursor still open — the window is NOT covered`],
    meetings: state.meetings,
    pages: state.pages,
    warnings: state.warnings,
  });
}

/**
 * What a failure on the FIRST page means, which is a different fact to a failure on a later one.
 *
 * Nothing has arrived, so there is nothing to commit and no partial window to describe — the lane is either
 * unreachable or its key is dead, and those are the two answers a caller can act on differently.
 *
 * @param error the typed boundary failure
 * @returns the domain error naming which of the two it was
 * @internal
 */
function firstPageFailure({ error }: { error: IngestError }): FathomError {
  return isUnauthorised({ error }) ? FathomErrors.unauthorised() : FathomErrors.fetchFailed({ cause: error });
}

/**
 * A window bound as Fathom's own filter spells it.
 *
 * The window carries plain dates (`YYYY-MM-DD`) and the provider's example is a full instant
 * (`created_after=<RFC 3339 instant>`), so a bare date is widened to the start of that day in UTC. A
 * value that already carries a time is passed through untouched.
 *
 * @param date the window bound
 * @returns the bound as an instant, or undefined when the window carried none
 */
export function isoBound({ date }: { date: string }): string | undefined {
  const trimmed = date.trim();
  if (trimmed === "") {
    return undefined;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
}
