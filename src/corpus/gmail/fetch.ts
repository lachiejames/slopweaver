/**
 * The Gmail fetch lane: decide which of the two crawls to run, run it, and say which one it was.
 *
 * ## Two crawls, and why the source needs both
 *
 * - **The DELTA crawl** asks `users.history.list` for every message added since a stored `historyId`. It is
 *   the only incremental read in this repository keyed on an ARRIVAL SEQUENCE rather than on a timestamp:
 *   one call returns exactly what changed, where a window read re-lists everything in the range and
 *   discovers by dedup that it already had it.
 *
 *   What it does NOT buy is worth writing down, because the obvious argument for it is wrong. A mail
 *   delivered today carrying a `Date:` header from last month is NOT missed by the window lane: Gmail's
 *   `after:`/`before:` filter on the message's internal date, which is the same field `internalDate`
 *   reports and therefore the same instant a record's `tsIso` carries — so the header date never enters the
 *   comparison on either side. The genuine gap is narrower: a message IMPORTED into the mailbox with its
 *   internal date backdated (a migration, a restored archive) sorts into a window the crawl has already
 *   passed, and only the arrival sequence sees it. That, plus the call cost, is the honest case.
 * - **The WINDOW crawl** asks `users.messages.list` for a date range, exactly as every other connector
 *   does. It is the fallback, and it is not an unusual one: Google keeps roughly a week of history, so a
 *   fortnight with no refresh EXPIRES the anchor and this is what runs. Treating that as an error would
 *   mean a connector that stops working the first time nobody runs a refresh over a holiday. It is also
 *   why the fallback is a genuine recovery rather than a lesser one: because the two lanes filter on the
 *   same clock, the window from the pooled `tsIso` cursor covers everything the expired anchor would have
 *   reported, bar the backdated-import case above.
 *
 * The lane picks between them from the stored anchor, and — the half that is easy to omit — falls from the
 * first to the second WITHIN one run when Google refuses the cursor, rather than failing the refresh and
 * leaving the operator to work out that the fix is to widen a window.
 *
 * ## What each crawl anchors on
 *
 * A window crawl re-anchors on the `historyId` read from `users.getProfile` BEFORE it starts. Anything
 * delivered while it runs then sits after that id and is picked up next pass. Anchoring on the id current
 * when the crawl FINISHES would silently skip exactly that window — and a mailbox crawl is long enough for
 * it to be a window rather than a race. Re-reading a few messages next pass is free, because bronze
 * deduplicates; missing them is permanent.
 *
 * A delta crawl anchors on the `historyId` the final page reported, which is Gmail's own statement of where
 * the log now ends.
 *
 * Effectful only through the injected {@link ../../live/gmail/api.GmailApi}, so every decision below is
 * exercised against plain object fakes.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "../../live/gmail/api.js";
import type { GmailError } from "../../live/gmail/errors.js";
import { type ParsedGmailMessage, parseGmailMessage } from "../../live/gmail/parse.js";
import { type SourceProgress, sourceHeartbeat } from "../progress.js";
import type { ExportWindow } from "../types.js";
import { recoveryWindow, walkHistory } from "./deltaAnchor.js";
import { anchorTakenAt, type GmailHistoryAnchor } from "./historyAnchor.js";

/** How many message ids one `messages.list` page asks for. Gmail's own maximum. */
const GMAIL_PAGE_SIZE = 100;

/**
 * The hard ceiling on pages a single crawl will walk.
 *
 * A bound rather than a budget: it exists so an unexpected cursor loop cannot spend a mailbox's worth of
 * quota, not to shape a normal run. Reaching it is reported as a COVERAGE GAP, which HOLDS the cursor, so
 * nothing is ever stepped over silently.
 *
 * A held cursor is not the same as convergence, and on a NARROW window it still is not: the next run asks
 * the same question and stops in the same place, which is why {@link pageCeilingGap} names the remedy
 * (narrow the window) instead of only reporting the bound.
 *
 * The EPOCH-WIDE case is the one that used to have no remedy at all, and now does. A full-history crawl
 * that stops here records the oldest instant it reached as a
 * {@link ./historyAnchor.GmailBackfillFloor}, and the next epoch-wide pass asks for everything before it —
 * so the backfill converges in ceiling-sized bites instead of re-walking the same pages forever. The
 * ceiling itself stays a runaway guard: at {@link GMAIL_PAGE_SIZE} ids a page it is far above any single
 * window this connector expects, and it exists so an unexpected cursor loop cannot spend a mailbox's worth
 * of quota before anyone notices.
 */
export const GMAIL_MAX_PAGES = 200;

/** Which crawl ran, so the run can say so rather than leaving the operator to infer it. */
type GmailCrawlLane = "delta" | "window";

/**
 * The bound a `--sample`/`--fetch-cap` run puts on how many messages a crawl READS.
 *
 * It has to live here rather than in the shared `capPerContainer` the other sources rely on, and the reason
 * is the shape of this job: a mailbox is ONE container and this lane commits its own records, so the shell's
 * post-fetch cap is handed an empty list and silently bounds nothing. A capped run that ingested the whole
 * mailbox anyway is not a small surprise — it is the flag doing the opposite of what it says.
 *
 * Truncating here is NOT a coverage gap. A gap means the crawl tried to see its window and could not; this
 * is the caller deliberately asking for less, which the ingest shell already answers by holding the pooled
 * cursor, and which this connector answers by holding its anchor too.
 */
export interface GmailReadCap {
  readonly maxMessages: number;
}

/** What a crawl produced. */
export interface GmailCrawlResult {
  readonly messages: readonly ParsedGmailMessage[];
  readonly lane: GmailCrawlLane;
  /** The `historyId` to store once these messages are committed, when one could be established. */
  readonly nextHistoryId: string | undefined;
  /** Whether this crawl covered the mailbox from the epoch — the sticky full-crawl marker. */
  readonly fullCrawl: boolean;
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
  /** Non-empty when the crawl did not see its whole window, which HOLDS the cursor. */
  readonly gaps: readonly string[];
  /** True when a {@link GmailReadCap} stopped this crawl short of what its lane offered. */
  readonly capped: boolean;
  /**
   * What the stored {@link ./historyAnchor.GmailBackfillFloor} should become after this crawl commits.
   *
   * `{ kind: "hold" }` on every crawl that is not an epoch-wide window walk — a delta pass and a narrow
   * window have nothing to say about how far back the mailbox has been read. `{ kind: "move", floorIso }`
   * when a full-history walk stopped at the page ceiling, naming the oldest instant it reached.
   * `{ kind: "clear" }` when a full-history walk finished, which is the statement that the backfill has
   * converged and the next epoch-wide crawl should start at today again.
   */
  readonly backfillFloor:
    { readonly kind: "hold" } | { readonly kind: "clear" } | { readonly kind: "move"; readonly floorIso: string };
}

/**
 * Turn a window's `since`/`until` into the Gmail search expression that bounds it.
 *
 * Gmail's `after:`/`before:` take a date and are evaluated against the message's INTERNAL date, which is
 * when Google received it — the same instant `internalDate` reports and therefore the same instant a
 * record's `tsIso` carries. `before:` is exclusive of the named day, which matches this repo's `until`
 * already being an exclusive upper bound (today + 1), so the two conventions line up with no adjustment.
 * Pure.
 *
 * @param window the export window, whose bounds are `YYYY-MM-DD`-prefixed
 * @returns the Gmail search expression
 */
export function windowQuery({ window }: { window: ExportWindow }): string {
  const since = window.since.slice(0, 10);
  const until = window.until.slice(0, 10);
  // A window can arrive INVERTED, and on the recovery path that is the difference between a fallback that
  // works and one that silently returns nothing. `since` is the pooled cursor — the newest `tsIso` in
  // bronze — and a single message with a future `internalDate` (a mis-clocked sender, a calendar invite)
  // pushes it past `until`, which is only ever today plus a day. Observed on a real run, whose window line
  // read `<since>..<until>` with since one day after until. The delta lane hides it because it ignores the window entirely; the
  // expiry fallback does not, and would ask Gmail for `after:X before:X` and be told, correctly, nothing.
  return `after:${since > until ? until : since} before:${until}`;
}

/**
 * Fetch and parse one message in full, tolerating a single failure rather than losing the crawl.
 *
 * A message that will not fetch becomes a warning and the crawl continues. One unreadable message out of a
 * mailbox must not cost every message beside it, and the deliberate omission is reported by name so it is
 * visible rather than merely absent.
 *
 * @param api the injected Gmail seam
 * @param id the message id to read
 * @param sink the warnings list, appended to when the read fails (mutated)
 * @returns the parsed message, or undefined when it could not be read or carried no addressable identity
 */
async function readOne({
  api,
  id,
  sink,
}: {
  api: GmailApi;
  id: string;
  sink: string[];
}): Promise<ParsedGmailMessage | undefined> {
  const fetched = await api.getMessage({ format: "full", id });
  if (fetched.isErr()) {
    sink.push(`message ${id}: not read (${fetched.error.message})`);
    return undefined;
  }
  return parseGmailMessage({ message: fetched.value });
}

/**
 * Read every message the ids name, in order, up to any read cap.
 *
 * @param api the injected Gmail seam
 * @param ids the message ids to read
 * @param cap the caller's deliberate bound, when one was given
 * @param onProgress the injected progress seam, called once per message read
 * @returns the parsed messages, one warning per id that could not be read, and whether the cap truncated
 */
async function readAll({
  api,
  ids,
  cap,
  onProgress,
}: {
  api: GmailApi;
  ids: readonly string[];
  cap: GmailReadCap | undefined;
  onProgress: SourceProgress | undefined;
}): Promise<{ messages: readonly ParsedGmailMessage[]; warnings: readonly string[]; capped: boolean }> {
  // An uncapped run reads every id it was given; a cap is the caller's deliberate bound on how many.
  const wanted = cap === undefined ? ids : ids.slice(0, cap.maxMessages);
  const warnings: string[] = [];
  const messages: ParsedGmailMessage[] = [];
  for (const [index, id] of wanted.entries()) {
    const parsed = await readOne({ api, id, sink: warnings });
    if (parsed !== undefined) {
      messages.push(parsed);
    }
    // Emitted per message rather than per page, because this loop is where the wall-clock goes: one
    // `messages.get` each, and a first full crawl of a real mailbox is thousands of them. Without a
    // heartbeat the run's own stall watchdog reports "(stalled)" on a crawl that is working perfectly,
    // which is worse than silence — it is a wrong answer to "is this stuck".
    // The phase is the BARE sub-phase: `toRichProgressEvent` prefixes the source itself, so naming it
    // `gmail.messages` here renders as `gmail.gmail.messages` and title-cases into the garbled label
    // "Gmail gmail messages". Caught by RUNNING the verb, not by a unit test — the test asserted this raw
    // field and was self-consistently wrong, which is why it now asserts the rendered label instead.
    onProgress?.(sourceHeartbeat({ done: index + 1, phase: "messages", source: "gmail", total: wanted.length }));
  }
  return { capped: wanted.length < ids.length, messages, warnings };
}

/** One page walk's outcome: the ids it gathered, and whether it stopped because it hit the page ceiling. */
interface PagedIds {
  readonly ids: readonly string[];
  readonly cappedByPageCeiling: boolean;
  /** The history id the last page reported, for the delta walk (a window walk never sets it). */
  readonly historyId: string | undefined;
}

/**
 * Walk `messages.list` over a query until Gmail stops giving cursors or the page ceiling is reached.
 *
 * @param api the injected Gmail seam
 * @param query the Gmail search expression bounding the crawl
 * @param cap the caller's deliberate bound, which stops the paging as well as the reading
 * @returns the gathered ids and whether the walk was cut short, or the first page failure
 */
async function walkWindow({
  api,
  query,
  cap,
}: {
  api: GmailApi;
  query: string;
  cap: GmailReadCap | undefined;
}): Promise<Result<PagedIds, GmailError>> {
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;
  for (let page = 0; page < GMAIL_MAX_PAGES; page += 1) {
    const listed = await api.listMessageIds({ labelIds: [], limit: GMAIL_PAGE_SIZE, pageToken, query });
    if (listed.isErr()) {
      return err(listed.error);
    }
    ids.push(...listed.value.ids);
    pageToken = listed.value.nextPageToken;
    // A capped run stops LISTING as well as reading. Paging on to gather ids it has already decided not to
    // read would make the cap bound the reads and not the requests, which is the half of `--fetch-cap` that
    // exists to keep a bounded run's API spend small.
    if (pageToken === undefined || (cap !== undefined && ids.length >= cap.maxMessages)) {
      return ok({ cappedByPageCeiling: false, historyId: undefined, ids });
    }
  }
  return ok({ cappedByPageCeiling: true, historyId: undefined, ids });
}

/**
 * The gap line a page-capped walk reports, which is what HOLDS the cursor for the next run.
 *
 * It names the REMEDY, and that is the load-bearing half. A held cursor means the next run asks the same
 * question — so on a window genuinely larger than the ceiling, an unremedied gap is a loop rather than a
 * recovery: every run re-crawls the same pages and stops in the same place. Narrowing the window is what
 * breaks it, and a gap line that did not say so would leave an operator watching a run repeat itself with
 * no way to tell that from a run making progress.
 *
 * The ceiling itself stays a runaway guard rather than a budget — {@link GMAIL_MAX_PAGES} × the page size
 * is far above any window this connector is expected to be handed, and it exists so an unexpected cursor
 * loop cannot spend a mailbox's worth of quota before anyone notices.
 *
 * @param lane which crawl hit the ceiling
 * @returns the gap line, naming the bound and what to do about it
 */
function pageCeilingGap({ lane, resumingFrom }: { lane: GmailCrawlLane; resumingFrom: string | undefined }): string {
  const bound =
    `the ${lane} crawl stopped at the ${String(GMAIL_MAX_PAGES)}-page ceiling ` +
    `(${String(GMAIL_MAX_PAGES * GMAIL_PAGE_SIZE)} messages) with more outstanding, so it did not cover its window`;
  if (resumingFrom === undefined) {
    return (
      `${bound} and the cursor is HELD — narrow the window with --since/--until and run again, because ` +
      "re-running the same window will stop in the same place"
    );
  }
  return (
    `${bound}. This is a FULL-HISTORY backfill, so it made progress rather than looping: everything from ` +
    `${resumingFrom} forward is now crawled, and the next --all run resumes before that instant. Run it ` +
    "again to continue; the history anchor stays HELD until the backfill converges"
  );
}

/**
 * Run the WINDOW crawl: anchor first, then list the window and read what it names.
 *
 * @param api the injected Gmail seam
 * @param window the export window to crawl
 * @param epochWide whether this window starts at the epoch, i.e. whether it crawls the whole mailbox
 * @param why the one-line reason this lane was chosen, reported as a note
 * @param cap the caller's deliberate bound on how many messages to read, when one was given
 * @param onProgress the injected progress seam, so a long crawl is visible rather than silent
 * @param backfillFloorIso the stored backfill floor, honoured only on an epoch-wide walk
 * @returns the crawl result, or the failure that stopped it
 */
async function crawlWindow({
  api,
  window,
  epochWide,
  why,
  cap,
  onProgress,
  backfillFloorIso,
}: {
  api: GmailApi;
  window: ExportWindow;
  epochWide: boolean;
  why: string;
  cap: GmailReadCap | undefined;
  onProgress: SourceProgress | undefined;
  backfillFloorIso: string | undefined;
}): Promise<Result<GmailCrawlResult, GmailError>> {
  // BEFORE the crawl, never after — see the module note. A profile read that fails is not fatal: the crawl
  // can still ingest, it simply cannot re-anchor, and losing the anchor costs one more window crawl next
  // time while losing the messages would cost the run.
  const profile = await api.getProfile();
  const anchorId = profile.isOk() ? profile.value.historyId : undefined;
  const anchorWarnings = profile.isErr()
    ? [`could not read the mailbox history anchor (${profile.error.message})`]
    : [];
  const query = windowQuery({ window: resumeWindow({ backfillFloorIso, epochWide, window }) });
  const walked = await walkWindow({ api, cap, query });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const read = await readAll({ api, cap, ids: walked.value.ids, onProgress });
  const ceiling = walked.value.cappedByPageCeiling;
  const oldest = oldestSentAt({ messages: read.messages });
  return ok({
    // A backfill floor only ever moves on an EPOCH-WIDE walk that read something: a narrow window has no
    // claim about how far back the mailbox has been read, and a capped run deliberately read less than it
    // could have, so neither may move a cursor. Same rule the anchor obeys, one cursor over.
    backfillFloor: backfillFloorState({ capped: read.capped, ceiling, epochWide, oldest }),
    capped: read.capped,
    // A capped run has not crawled the mailbox, whatever its window said.
    fullCrawl: epochWide && !ceiling && !read.capped,
    gaps: ceiling ? [pageCeilingGap({ lane: "window", resumingFrom: epochWide ? oldest : undefined })] : [],
    lane: "window",
    messages: read.messages,
    nextHistoryId: anchorId,
    notes: [
      `${why} — crawled \`${query}\`, ${String(walked.value.ids.length)} message(s) matched`,
      ...(backfillFloorIso === undefined || !epochWide
        ? []
        : [
            `resumed a full-history backfill below ${backfillFloorIso} — everything from there forward is ` +
              "already crawled",
          ]),
    ],
    warnings: [...anchorWarnings, ...read.warnings],
  });
}

/**
 * The window a walk actually asks for, which is the planned one unless a full-history backfill is resuming.
 *
 * The floor's own DAY becomes the exclusive `before:`, which re-reads that whole day and therefore cannot
 * skip across it — the overlap costs a handful of duplicate reads that bronze absorbs, and the alternative
 * (an instant-precise bound Gmail's date filter cannot express) would drop every message sharing the
 * boundary day with the last one read. Pure.
 *
 * @param window the window the run was planned with
 * @param epochWide whether this walk asks for the whole mailbox
 * @param backfillFloorIso the stored floor, honoured only on an epoch-wide walk
 * @returns the window to crawl
 */
function resumeWindow({
  window,
  epochWide,
  backfillFloorIso,
}: {
  window: ExportWindow;
  epochWide: boolean;
  backfillFloorIso: string | undefined;
}): ExportWindow {
  if (!epochWide || backfillFloorIso === undefined) {
    return window;
  }
  return { since: window.since, until: backfillFloorIso.slice(0, 10) };
}

/**
 * The OLDEST send time across a batch, or undefined when nothing in it could be dated. Pure.
 *
 * @param messages the parsed messages the crawl read
 * @returns the minimum `sentAtIso`, or undefined
 */
function oldestSentAt({ messages }: { messages: readonly ParsedGmailMessage[] }): string | undefined {
  return messages.reduce<string | undefined>(
    (oldest, message) =>
      message.sentAtIso !== undefined && (oldest === undefined || message.sentAtIso < oldest)
        ? message.sentAtIso
        : oldest,
    undefined,
  );
}

/**
 * What one window walk says the stored backfill floor should become. Pure.
 *
 * @param epochWide whether this walk asked for the whole mailbox
 * @param ceiling whether it stopped at the page ceiling with more outstanding
 * @param capped whether a deliberate read bound stopped it short
 * @param oldest the oldest instant it read, when it read anything datable
 * @returns the floor transition
 */
function backfillFloorState({
  epochWide,
  ceiling,
  capped,
  oldest,
}: {
  epochWide: boolean;
  ceiling: boolean;
  capped: boolean;
  oldest: string | undefined;
}): GmailCrawlResult["backfillFloor"] {
  if (!epochWide || capped) {
    return { kind: "hold" };
  }
  if (!ceiling) {
    return { kind: "clear" };
  }
  return oldest === undefined ? { kind: "hold" } : { floorIso: oldest, kind: "move" };
}

/**
 * Run the DELTA crawl, falling back to the window crawl within the same run when the anchor has expired.
 *
 * @param api the injected Gmail seam
 * @param anchor the stored mailbox anchor
 * @param window the export window the fallback would crawl
 * @param cap the caller's deliberate bound on how many messages to read, when one was given
 * @param onProgress the injected progress seam, so a long crawl is visible rather than silent
 * @returns the crawl result — from either lane — or the failure that stopped both
 */
async function crawlDelta({
  api,
  anchor,
  window,
  cap,
  onProgress,
}: {
  api: GmailApi;
  anchor: GmailHistoryAnchor;
  window: ExportWindow;
  cap: GmailReadCap | undefined;
  onProgress: SourceProgress | undefined;
}): Promise<Result<GmailCrawlResult, GmailError>> {
  const walked = await walkHistory({
    api,
    maxMessages: cap?.maxMessages,
    maxPages: GMAIL_MAX_PAGES,
    startHistoryId: anchor.historyId,
  });
  if (walked.isErr()) {
    if (walked.error.code !== "HISTORY_EXPIRED") {
      return err(walked.error);
    }
    // The ordinary outcome of a fortnight away, not an error. Recover in-run rather than failing the
    // refresh and leaving the operator to work out that the fix is to pass a wider window by hand.
    const recovered = await crawlWindow({
      api,
      backfillFloorIso: undefined,
      cap,
      onProgress,
      epochWide: false,
      why: `the stored history anchor ${anchor.historyId} had expired, so this run fell back to a date window`,
      window: recoveryWindow({ anchor, window }),
    });
    return recovered.map((result) => ({
      ...result,
      warnings: [...result.warnings, walked.error.message],
    }));
  }
  const read = await readAll({ api, cap, ids: walked.value.ids, onProgress });
  return ok({
    // A delta pass says nothing about how far BACK the mailbox has been read — it only ever saw what
    // arrived after its anchor — so it never touches the backfill floor.
    backfillFloor: { kind: "hold" },
    capped: read.capped,
    // A delta crawl never claims a full crawl — it only ever saw what arrived after its anchor. The sticky
    // marker in the anchor store is what carries a previous full crawl forward.
    fullCrawl: false,
    gaps: walked.value.cappedByPageCeiling ? [pageCeilingGap({ lane: "delta", resumingFrom: undefined })] : [],
    lane: "delta",
    messages: read.messages,
    nextHistoryId: walked.value.historyId,
    notes: [
      `resumed from history anchor ${anchor.historyId} (taken ${anchorTakenAt({ anchor })}) — ` +
        `${String(walked.value.ids.length)} message(s) added since`,
    ],
    warnings: read.warnings,
  });
}

/**
 * Crawl the mailbox, choosing the lane from the stored anchor.
 *
 * @param api the injected Gmail seam
 * @param anchor the stored anchor, or undefined when the mailbox has never been crawled
 * @param window the export window the window lane would use
 * @param epochWide whether `window` starts at the epoch, so a window crawl covers the whole mailbox
 * @param cap the caller's deliberate bound on how many messages to read, when one was given
 * @param onProgress the injected progress seam, so a long crawl is visible rather than silent
 * @param backfillFloorIso how far back a part-finished full-history backfill has already reached, so an
 *   epoch-wide crawl resumes below it instead of starting again at today
 * @returns the crawl result, or the failure that stopped it
 */
export async function crawlGmail({
  api,
  anchor,
  window,
  epochWide,
  cap,
  onProgress,
  backfillFloorIso,
}: {
  api: GmailApi;
  anchor: GmailHistoryAnchor | undefined;
  window: ExportWindow;
  epochWide: boolean;
  cap: GmailReadCap | undefined;
  onProgress: SourceProgress | undefined;
  backfillFloorIso: string | undefined;
}): Promise<Result<GmailCrawlResult, GmailError>> {
  if (anchor === undefined) {
    return crawlWindow({
      api,
      backfillFloorIso,
      cap,
      epochWide,
      onProgress,
      why: "no history anchor stored, so this mailbox has never been crawled",
      window,
    });
  }
  return crawlDelta({ anchor, api, cap, onProgress, window });
}
