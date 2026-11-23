/**
 * What the read token can REACH in Slack, and how much of it bronze actually holds.
 *
 * The standing rule this module implements: "every channel the owner can see" means everything for which an
 * API call would not return 403, not only the channels the owner is a member of. MEASURED against the real
 * workspace with the user token: 476 of 477 non-archived
 * conversations answered `conversations.history` — 321 of them public channels the owner has never joined —
 * and a further 126 archived channels answered it too while being excluded from discovery outright. The bot
 * token, by contrast, answered for exactly the channels it had been invited to. So membership is not the
 * access boundary for a user token; it is only a fact ABOUT a channel, and the connector treats it that way.
 * Reproduce with `slopweaver refresh --source slack --coverage`, which reports the same reachable-vs-backfilled
 * split live.
 *
 * Two pure concerns live here, both apart from the crawl's IO so they are testable without a workspace:
 *
 * - **{@link planChannelOldest}** — the per-channel lower bound. A channel with no stored cursor has never
 *   been backfilled, so it is read from the epoch ONCE; a channel with one is read from its own cursor, never
 *   from the pooled window if that would skip further ahead. Under an explicit window it is the stored
 *   COMPLETION MARKER, not the cursor, that decides whether the channel may be resumed rather than re-read —
 *   which is what lets a killed epoch-wide backfill skip the conversations it already finished.
 * - **{@link planChannelRead}** — the same question one level up: which lane detects this channel's changed
 *   threads, how far back the history walk goes, and how far back its rows are actually ingested.
 * - **{@link classifyChannelReach}** — reachable vs backfilled, and the gap between them, which is what turns
 *   "coverage" from a claim into something a report can refuse to sign off.
 */
import { parseIsoMs } from "../../lib/date.js";
import type { ChannelWatermarkEntry } from "./channelWatermark.js";
import type { SlackChannelRef } from "./fetch.js";
import { chooseThreadDetectionLane, HISTORY_PAGE_LIMIT, type ThreadDetectionLane } from "./threadOracle.js";

/** Slack's widest `oldest` sentinel: the whole of a channel's history. */
export const SLACK_EPOCH_OLDEST = "0";

/**
 * A floor no stored cursor may push past: the clock. Pure.
 *
 * A cursor is a claim about how far a channel has been READ, so a cursor ahead of now claims a span nobody
 * could have read, and using it as an ingest floor drops every message posted between the clock and it.
 * MEASURED on a real home: most of the hundreds of conversations carried tomorrow's date as their cursor
 * — banked from the window's `until`, which is today+1 — so the refresh log read
 * `slack D0SYN000003: history-oracle (walk from 0, ingest from 1789689600)` and the owner's same-day huddle
 * could not reach bronze at all. `./channelWatermark.ts#clampCursorToClock` stops that value being minted again; this
 * is what repairs a home that already holds one, because the store merges MAX and a cursor on disk can
 * never be lowered by a later run. The same two-sided shape as the calendar fix
 * (`../calendar/ingest.ts#pooledCursor` plus `../calendar/fetch.ts#windowBounds`).
 *
 * @param oldest the floor the plan would otherwise use, as Slack epoch seconds
 * @param nowIso the instant this pass is running at
 * @returns `oldest`, or the clock when `oldest` is ahead of it
 */
function noLaterThanClock({ oldest, nowIso }: { oldest: string; nowIso: string }): string {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined) {
    return oldest;
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  return Number(oldest) > nowSeconds ? String(nowSeconds) : oldest;
}

/**
 * The `oldest` bound to read ONE channel from, never later than the clock.
 *
 * @param stored the channel's own stored entry, or undefined when it has never been crawled at all
 * @param windowOldest the run's pooled window lower bound, as Slack epoch seconds
 * @param backfillNew whether a never-backfilled channel may be read from the epoch — false when the caller
 *   pinned an explicit window (`--since`/`--all`), because then the window IS the request and silently
 *   widening it would answer a different question from the one asked
 * @param nowIso the instant this pass is running at — see {@link noLaterThanClock}
 * @returns the Slack `oldest` epoch-seconds string for this channel
 */
export function planChannelOldest({
  stored,
  windowOldest,
  backfillNew,
  nowIso,
}: {
  stored: ChannelWatermarkEntry | undefined;
  windowOldest: string;
  backfillNew: boolean;
  nowIso: string;
}): string {
  // Capped ONCE, over every branch, rather than at each `return`. Not tidiness: `windowOldest` itself can sit
  // in the future, because the pooled watermark banks the window's `until` for a source that saw no usable
  // timestamp and `../../cli/commands/refresh/core.ts#buildRefreshWindows` reads that cursor back as
  // `window.since`. So the branch below that defers to the window is reachable with a future floor and no
  // stored cursor involved at all, and a per-branch cap would have covered the cursor and missed the window.
  return noLaterThanClock({ nowIso, oldest: rawChannelOldest({ backfillNew, stored, windowOldest }) });
}

/** {@link planChannelOldest} before the clock cap — the floor the window and the stored cursor agree on. */
function rawChannelOldest({
  stored,
  windowOldest,
  backfillNew,
}: {
  stored: ChannelWatermarkEntry | undefined;
  windowOldest: string;
  backfillNew: boolean;
}): string {
  if (!backfillNew) {
    return resumeExplicitWindow({ stored, windowOldest });
  }
  if (stored === undefined) {
    return SLACK_EPOCH_OLDEST;
  }
  const storedMs = parseIsoMs({ tsIso: stored.cursor });
  if (storedMs === undefined) {
    return windowOldest;
  }
  // The channel's OWN cursor wins outright over the pooled window, in both directions — but never over the
  // CLOCK, which is the caller's cap. The pooled floor is the max timestamp seen across every channel at
  // once, so for a channel that has been quiet since, it sits above everything that channel holds —
  // deferring to it would skip exactly the history this store exists to reach. In the other direction, a
  // cursor ahead of the pooled floor means this channel is already read further than the window asks, and
  // re-reading from the older floor would just re-fetch what bronze has. A cursor ahead of NOW is neither of
  // those: it is a claim about a span nobody read, and honouring it froze 560 conversations at tomorrow.
  return String(Math.floor(storedMs / 1000));
}

/**
 * The `oldest` for a channel under an EXPLICIT window (`--since`/`--all`/`--lookback-days`), where the window
 * is the request and a stored cursor may not silently narrow it.
 *
 * There is exactly one case where it may, and it is the one that makes a killed backfill resumable: **a
 * request whose own floor IS the Slack epoch** (`--all`) on a channel whose stored entry says it was read
 * from the epoch. Its coverage is `[epoch, cursor]`, one contiguous run, so everything the request asks for
 * below that cursor is already in bronze and re-reading it would fetch what the write path is about to dedup
 * away. That is how a restarted 36-hour backfill picks up where the killed one stopped instead of starting
 * over, and it is the ONLY case this function's own history motivates.
 *
 * **A request naming a real floor is not that case, and used to be treated as it.** `--since` and
 * `--lookback-days` are a deliberate re-read of a named span — the symmetric half of the rule already
 * stated in `../../cli/commands/refresh/tokenedJobsSlack.ts#ingestSlack`, that an explicit window IS the
 * request and nothing may silently WIDEN it. Narrowing one is worse than widening, because it is invisible:
 * MEASURED, `refresh --source slack --slack-channel D0SYN000003 --since <yesterday>
 * --lookback-days 2` reported success, ingested from the stored cursor's 1789689600 rather than the
 * requested floor, and wrote 0 rows. Deferring to a cursor claiming coverage to TOMORROW is the case that
 * made it visible; a cursor claiming coverage to an hour ago has the same shape and the same answer.
 *
 * Every other case falls back to the window verbatim, which is unchanged behaviour:
 *
 *  - no stored entry, or one with no completion marker — the previous read's lower bound is unknown, and
 *    unknown coverage is never a completion claim, so the whole window is re-read;
 *  - a cursor BELOW the requested floor — the channel has been quiet since, and the untouched span between
 *    cursor and floor was never actually read, so deferring to the cursor would widen the request rather than
 *    narrow it.
 *
 * Pure.
 */
function resumeExplicitWindow({
  stored,
  windowOldest,
}: {
  stored: ChannelWatermarkEntry | undefined;
  windowOldest: string;
}): string {
  // The floor the CALLER named. Only a request reaching back to the Slack epoch has nothing of its own to
  // lose by resuming, which is why the resume is keyed to the request rather than to the stored entry.
  if (Number(windowOldest) > 0) {
    return windowOldest;
  }
  if (stored?.fullHistory !== true) {
    return windowOldest;
  }
  const storedMs = parseIsoMs({ tsIso: stored.cursor });
  if (storedMs === undefined) {
    return windowOldest;
  }
  const storedSeconds = Math.floor(storedMs / 1000);
  return storedSeconds >= Number(windowOldest) ? String(storedSeconds) : windowOldest;
}

/**
 * How ONE conversation is read this pass: which lane detects its changed threads, how far back the history
 * walk goes, and how far back that walk's rows are actually ingested.
 *
 * The two bounds are separate because in the oracle lane they genuinely differ. The walk runs to the Slack
 * epoch so that every thread root in the channel — a parent of any age — reports its live `reply_count` and
 * `latest_reply`; the ingest floor stays exactly where it was, so bronze receives the same rows it would
 * have received from a watermark-bounded read. Reading a channel end to end is 6 calls on the thread-densest
 * one; re-projecting its whole history into bronze every refresh is not, and nothing needs it.
 *
 * In the poll lane the two are the same value, which is the pre-oracle behaviour exactly.
 *
 * `pinnedWindow` is the third field because the separation above holds for every row the WALK returns but
 * not for a thread the walk only names: see its own comment.
 */
export interface ChannelReadPlan {
  readonly lane: ThreadDetectionLane;
  /** The Slack `oldest` the history walk itself requests. */
  readonly walkOldest: string;
  /** The Slack `oldest` at or above which a walked row is shaped into bronze, and the completion marker. */
  readonly ingestOldest: string;
  /**
   * Whether this read has a caller-pinned floor BELOW which nothing may be ingested — an explicit window
   * (`--since`/`--until`/`--lookback-days`, or `--all` resuming a channel from its own cursor) whose
   * `ingestOldest` sits above the Slack epoch.
   *
   * It governs exactly one decision, in `channelPages.ts`: an oracle-lane root the walk surfaced that has NO
   * stored cursor is read WHOLE, and with a floor in play a parent of any age would then drag its entire
   * reply history in below it. A request whose own floor IS the epoch — `--all` on a channel never
   * backfilled — has nothing to undercut, so it reads that root whole and this is false.
   *
   * Carried as its own field rather than inferred from `walkOldest !== ingestOldest`, which is a coincidence
   * of two values rather than a fact about the request.
   */
  readonly pinnedWindow: boolean;
}

/**
 * Which lane one conversation takes this pass, and the two `oldest` bounds that follow. Pure.
 *
 * The ingest floor is whatever {@link planChannelOldest} decides, untouched — an explicit window IS the
 * request, and nothing here widens it. The WALK bound is a different quantity answering a different
 * question, and that is why the lane decision runs in every window mode: a walk writes nothing. `rowsToIngest`
 * (`./channelPages.ts`) filters every walked row by `ingestOldest` before it is shaped, and the `fullHistory`
 * completion marker is keyed to `ingestOldest` too (`./workspaceCrawl.ts`), so an epoch-wide walk under a
 * `--since <date>` request produces byte-for-byte the bronze that request asked for. What it buys is the
 * `reply_count`/`latest_reply` every root reports for free, which is the whole of `./threadOracle.ts`.
 *
 * MEASURED on a live workspace, tens of thousands of stored thread cursors across hundreds of channels:
 * pinning every channel to `poll-known-threads` under a window costs one `conversations.replies` call per
 * cursor, against **under a thousand** calls when the lane is free to choose (replies and history pages in
 * about equal parts). The sweep's own cost is about half a second per thread — a channel of a couple of
 * hundred threads took minutes over the floor measured on a 1-thread one, the floor being discovery plus
 * users, members and structures — so a windowed pass was hours of polling
 * and died at every timeout having written nothing. Reproduce with
 * `slopweaver refresh --source slack --lookback-days 2 --no-derive --slack-channel <id>` against a channel
 * whose stored cursor count you read out of `$SLOPWEAVER_HOME/corpus/.slack-threads.json`.
 *
 * @param backfillNew whether a never-backfilled channel may be read from the epoch — false under an explicit
 *   window, which is also what makes the read a pinned one
 * @param knownThreads how many of this channel's threads the cursor store already holds
 * @param stored this channel's stored watermark entry, or undefined when it has never been crawled
 * @param windowOldest the run's pooled window lower bound, as Slack epoch seconds
 * @param nowIso the instant this pass is running at — no floor may sit ahead of it
 * @returns the lane, the two bounds, and whether the window was pinned
 */
export function planChannelRead({
  backfillNew,
  knownThreads,
  stored,
  windowOldest,
  nowIso,
}: {
  backfillNew: boolean;
  knownThreads: number;
  stored: ChannelWatermarkEntry | undefined;
  windowOldest: string;
  nowIso: string;
}): ChannelReadPlan {
  const ingestOldest = planChannelOldest({ backfillNew, nowIso, stored, windowOldest });
  const lane = chooseThreadDetectionLane({
    knownMessages: stored?.messages,
    knownThreads,
    pageLimit: HISTORY_PAGE_LIMIT,
  });
  return {
    ingestOldest,
    lane,
    // A floor the caller pinned, which a whole-thread read could undercut. `--all` pins a window and its
    // floor IS the epoch, so nothing can sit below it and an unseen thread is read whole exactly as the
    // request asked — which is why this is not simply `!backfillNew`.
    pinnedWindow: !backfillNew && Number(ingestOldest) > 0,
    walkOldest: lane === "history-oracle" ? SLACK_EPOCH_OLDEST : ingestOldest,
  };
}

/** How a reachable conversation is counted in the coverage report. */
export type ReachKind = "public" | "private" | "dm" | "group-dm";

/** One reachable conversation, as the coverage report describes it. */
export interface ChannelReach {
  readonly id: string;
  readonly name?: string;
  readonly kind: ReachKind;
  readonly archived: boolean;
  readonly member: boolean;
  /** Whether this conversation has ever been crawled — i.e. it holds a per-channel watermark entry. */
  readonly backfilled: boolean;
}

/**
 * Which lane a discovered conversation is counted in. Pure.
 *
 * @param channel the discovered channel ref
 * @returns the reach kind
 */
export function reachKind({ channel }: { channel: SlackChannelRef }): ReachKind {
  if (channel.isIm === true) {
    return "dm";
  }
  if (channel.isMpim === true) {
    return "group-dm";
  }
  return channel.isPrivate === true ? "private" : "public";
}

/**
 * Join every discovered conversation against the per-channel backfill state.
 *
 * @param discovered every conversation `conversations.list` returned
 * @param cursors the per-channel watermark map — presence, not value, is what marks a channel backfilled
 * @returns one row per reachable conversation, in discovery order
 */
export function classifyChannelReach({
  discovered,
  cursors,
}: {
  discovered: readonly SlackChannelRef[];
  cursors: ReadonlyMap<string, ChannelWatermarkEntry>;
}): readonly ChannelReach[] {
  return discovered.map((channel) => ({
    archived: channel.isArchived === true,
    backfilled: cursors.has(channel.id),
    id: channel.id,
    kind: reachKind({ channel }),
    member: channel.isMember === true,
    ...(channel.name !== undefined ? { name: channel.name } : {}),
  }));
}

/** The per-kind reachable/backfilled tally the coverage report prints. */
export interface ReachTally {
  readonly kind: ReachKind;
  readonly reachable: number;
  readonly backfilled: number;
}

/** Every reach kind, in report order — named once so a tally can list a lane that happens to be empty. */
const REACH_KINDS: readonly ReachKind[] = ["public", "private", "group-dm", "dm"];

/**
 * The per-kind tally over classified reach rows. Pure.
 *
 * @param rows the classified reach rows
 * @returns one tally per kind, in report order, including kinds with nothing in them
 */
export function tallyChannelReach({ rows }: { rows: readonly ChannelReach[] }): readonly ReachTally[] {
  return REACH_KINDS.map((kind) => {
    const inKind = rows.filter((row) => row.kind === kind);
    return { backfilled: inKind.filter((row) => row.backfilled).length, kind, reachable: inKind.length };
  });
}

/**
 * The reachable conversations bronze has never crawled — the report's refusal condition.
 *
 * @param rows the classified reach rows
 * @returns the never-backfilled rows, in discovery order
 */
export function coverageGaps({ rows }: { rows: readonly ChannelReach[] }): readonly ChannelReach[] {
  return rows.filter((row) => !row.backfilled);
}
