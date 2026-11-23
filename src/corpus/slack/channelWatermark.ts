/**
 * The per-channel Slack backfill state: `channelId → the max `tsIso` observed for that channel`, so a crawl
 * resumes each channel from its OWN cursor and — the part the pooled per-source watermark cannot express —
 * knows which channels have never been crawled at all.
 *
 * ## Why the pooled watermark is not enough
 *
 * `corpus/watermarks/slack.json` holds one cursor for the whole workspace. Every channel is read forward from
 * it, which is correct for a channel that was already crawled and wrong for every other case. MEASURED
 * against the real workspace: 161 conversations the user token can read hold ZERO bronze rows
 * while carrying real messages — among them one 1,975-message channel whose history reaches back over a year.
 * Each one was, at some point, first seen AFTER the pooled cursor had already advanced, so the only window
 * ever offered to it started later than everything it contains. The pooled cursor cannot tell that state from
 * "crawled, and quiet": both are simply absent from it.
 *
 * So the store records an entry for every channel the crawl VISITED, including one that turned out to hold
 * nothing. A channel with an entry is incremental from its cursor; a channel with no entry has never been
 * backfilled and is read from the epoch, once. That is the whole rule, and it is why a visited-but-empty
 * channel must still write an entry — otherwise it is re-backfilled from the epoch on every single run.
 *
 * An entry also records whether the channel was ever read from the Slack EPOCH ({@link ChannelWatermarkEntry}'s
 * `fullHistory`). A cursor alone cannot say that, and the gap was expensive: an epoch-wide `--all` request has
 * to ignore every stored cursor, because a recent cursor is equally consistent with "read end to end" and
 * with "the only window this channel was ever offered started last quarter". So `--all` re-read all 603
 * conversations from the epoch every time, and two killed 36-hour runs kept nothing. The marker is what lets
 * a restarted backfill skip the conversations the previous attempt finished.
 *
 * Merge is MAX at the leaf and STICKY on the completion marker, so a narrower re-run can never move a
 * channel's cursor backwards nor un-backfill it; writes are atomic (tmp + rename). Shaped deliberately after
 * `../github/repoWatermark.ts`, which solved the same "one busy container must not drag the quiet ones
 * forward" problem for GitHub org mode.
 */
import { readFileSync } from "node:fs";
import { slopweaverHome } from "../../config.js";
import { clampIsoToClock } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type SlackCursorWriteError, SlackCursorWriteErrors } from "./cursorWriteErrors.js";

interface ChannelWatermarkFile {
  readonly version: 1;
  readonly channels: Record<string, ChannelWatermarkEntry>;
}

/**
 * One channel's stored backfill state.
 *
 * `fullHistory` is the COMPLETION MARKER, and it carries what a cursor alone cannot: whether this channel was
 * ever read from the Slack epoch. Without it an epoch-wide request (`--all`) has no way to tell a channel
 * that has been read end to end from one whose cursor merely happens to be recent because a 90-day window was
 * the only window it was ever offered — so `--all` re-reads every channel from the epoch on every run, which
 * is exactly why two killed 36-hour backfills kept nothing. Absent on a legacy entry, which reads as `false`:
 * unknown coverage is never a completion claim.
 */
export interface ChannelWatermarkEntry {
  readonly cursor: string;
  readonly fullHistory?: boolean;
  /**
   * How many top-level messages a COMPLETED history walk of this channel was served, when one has happened.
   *
   * Recorded only by a walk that reached the end of the channel, so the number means "this channel holds at
   * least this many", never "this many were ingested this pass". It is the `knownMessages` half of the
   * per-channel lane decision in `./threadOracle.ts#chooseThreadDetectionLane` — the half that keeps one bot
   * firehose (≥1,000,000 top-level messages, 42 threads) out of a history walk that would cost 1,002 calls to
   * check 42 threads. Absent on an entry written before the field existed, which reads as "never counted".
   */
  readonly messages?: number;
}

const EMPTY: ChannelWatermarkFile = { channels: {}, version: 1 };

/**
 * One channel's cursor advance: channel id → the max observed `tsIso`, or the window end when it held none,
 * and in neither case later than the clock that read it ({@link clampCursorToClock}).
 */
export interface ChannelWatermarkAdvance {
  readonly channel: string;
  readonly cursor: string;
  /** Whether THIS read started at the Slack epoch, i.e. it backfilled the channel's whole history. */
  readonly fullHistory: boolean;
  /** Top-level messages this read was served, when its history walk ran to exhaustion — see the entry. */
  readonly messages?: number;
}

/**
 * The cursor one channel may bank — what it read, never later than the clock that read it.
 *
 * A cursor answers HOW FAR THROUGH TIME this channel has been read, and a pass that ran at `nowIso` cannot
 * have read past `nowIso` whatever bound it was handed. The window's `until` is today+1, an EXCLUSIVE upper
 * bound (`cli/commands/refresh/core.ts#refreshWindowLogLine` renders it clamped to today for exactly this
 * reason), so a channel that was read and held nothing banked TOMORROW — and here, unlike the pooled
 * watermark, that value is load-bearing: `./reach.ts#planChannelOldest` hands it straight back as the run's
 * ingest floor, so nothing posted for the rest of the day can ever be shaped into bronze.
 *
 * MEASURED on a real home: **most of the hundreds of** conversations carried the bare-day
 * cursor of tomorrow, banked while the clock still read today, among them the DM holding the owner's
 * same-day huddle. Reproduce the shape of it with:
 *
 * ```bash
 * jq '.channels | to_entries | map(.value.cursor[0:10]) | group_by(.) | map({d:.[0],n:length})' \
 *   "$SLOPWEAVER_HOME/corpus/.slack-channels.watermark.json"
 * ```
 *
 * The comparison itself is `../../lib/date.ts#clampIsoToClock`, which is the ONE spelling of this rule for
 * the whole repo — this function is the Slack-shaped name for it and the place its measurement lives.
 * `../calendar/ingest.ts#pooledCursor` and `../watermark.ts#computeSourceWatermarks` are the other two
 * callers, and the third of them is what made a shared function worth having. Pure.
 *
 * @param cursor what this pass actually read to — an observed `tsIso`, or the window end when it saw none
 * @param nowIso the instant this pass ran, which is as far through time as reading a channel can prove
 * @returns the cursor to bank
 */
function clampCursorToClock({ cursor, nowIso }: { cursor: string; nowIso: string }): string {
  return clampIsoToClock({ nowIso, tsIso: cursor });
}

/**
 * The advance to store for every channel the crawl VISITED — its max observed `tsIso`, or `fallbackUntil`
 * when it yielded no usable timestamp, and in neither case later than the clock. Pure.
 *
 * `visited` is a separate input from `observed` on purpose: a channel that was read and held nothing must
 * still get an entry, because the entry is what records "this one has been backfilled". Deriving the visited
 * set from `observed` alone would leave every empty channel permanently un-backfilled, so it would be
 * re-read from the epoch on every run — the exact cost this store exists to pay once.
 *
 * The clock clamp is applied to the RESULT rather than to `fallbackUntil` alone ({@link clampCursorToClock}
 * carries the measurement): a Slack `ts` is server-assigned at post time, so an observed timestamp in the
 * future is a defect signal too, and clamping only the fallback would encode the weaker claim.
 *
 * @param visited every channel id the crawl actually read history for
 * @param observed every `(channel, tsIso)` the crawl saw
 * @param fallbackUntil the window end, stored for a channel that yielded no usable timestamp
 * @param nowIso the instant this pass ran — no channel banks a cursor later than this
 * @param fullHistory the visited channels this crawl read from the Slack epoch — the completion marker; a
 *   visited channel absent from it was read over a narrower window and is not claimed as fully backfilled
 * @param walkedMessages channel id → top-level rows a COMPLETED history walk was served, for the channels
 *   whose walk actually ran to exhaustion; a channel absent from it keeps whatever count it already had
 * @returns one advance per visited channel
 */
export function computeChannelWatermarks({
  visited,
  observed,
  fallbackUntil,
  nowIso,
  fullHistory = [],
  walkedMessages = new Map(),
}: {
  visited: readonly string[];
  observed: readonly { channel: string; tsIso: string }[];
  fallbackUntil: string;
  nowIso: string;
  fullHistory?: readonly string[];
  walkedMessages?: ReadonlyMap<string, number>;
}): readonly ChannelWatermarkAdvance[] {
  const maxByChannel = new Map<string, string>();
  for (const { channel, tsIso } of observed) {
    const currentMax = maxByChannel.get(channel);
    if (tsIso.length > 0 && (currentMax === undefined || tsIso > currentMax)) {
      maxByChannel.set(channel, tsIso);
    }
  }
  const backfilled = new Set(fullHistory);
  return [...new Set(visited)].map((channel) => {
    const walked = walkedMessages.get(channel);
    return {
      channel,
      cursor: clampCursorToClock({
        cursor: readThrough({ fallbackUntil, observedMax: maxByChannel.get(channel) }),
        nowIso,
      }),
      fullHistory: backfilled.has(channel),
      ...(walked !== undefined ? { messages: walked } : {}),
    };
  });
}

/**
 * What one channel was read THROUGH: its max observed `tsIso`, or the window end when it yielded none.
 *
 * The absent case is named rather than swallowed by a `??`, because it is the whole point of this store —
 * a channel that was VISITED and held nothing must still get an entry, or it is re-backfilled from the
 * epoch on every run. Pure.
 *
 * @param observedMax the newest `tsIso` this channel yielded, absent when it yielded none at all
 * @param fallbackUntil the window end, which is what "read to the end of the window and saw nothing" means
 * @returns the instant this channel was read through, before the clock cap
 */
function readThrough({
  observedMax,
  fallbackUntil,
}: {
  observedMax: string | undefined;
  fallbackUntil: string;
}): string {
  if (observedMax === undefined) {
    return fallbackUntil;
  }
  return observedMax;
}

/** Read + validate the per-channel watermark file; anything unrecognised degrades to empty. */
function readChannelWatermarkFile({ home }: { home: string }): ChannelWatermarkFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stateHomePaths({ home }).corpus.slackChannelsWatermark, "utf8"));
  } catch {
    return EMPTY;
  }
  if (!isRecord(raw) || !isRecord(raw["channels"])) {
    return EMPTY;
  }
  const channels: Record<string, ChannelWatermarkEntry> = {};
  for (const [key, value] of Object.entries(raw["channels"])) {
    if (isRecord(value) && typeof value["cursor"] === "string") {
      const messages = value["messages"];
      channels[key] = {
        cursor: value["cursor"],
        fullHistory: value["fullHistory"] === true,
        ...(typeof messages === "number" && Number.isFinite(messages) ? { messages } : {}),
      };
    }
  }
  return { channels, version: 1 };
}

/**
 * The stored entry per channel id, as a lookup map. A channel ABSENT from this map has never been
 * crawled at all — that absence is the signal, not an incidental empty value.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the channel id → stored entry map (empty when no file)
 */
export function readSlackChannelWatermarks({ home = slopweaverHome() }: { home?: string } = {}): ReadonlyMap<
  string,
  ChannelWatermarkEntry
> {
  return new Map(Object.entries(readChannelWatermarkFile({ home }).channels));
}

/** Merge incoming advances into the current file: MAX at every cursor, sticky on every marker. Pure. */
function mergeChannelWatermarks({
  current,
  incoming,
}: {
  current: ChannelWatermarkFile;
  incoming: readonly ChannelWatermarkAdvance[];
}): ChannelWatermarkFile {
  const channels = { ...current.channels };
  for (const { channel, cursor, fullHistory, messages } of incoming) {
    const existing = channels[channel];
    // MAX on the cursor, and STICKY on the completion marker. Sticky is sound rather than optimistic: once a
    // channel has been read from the epoch, every later read of it starts at its own stored cursor, so its
    // coverage stays one contiguous run from the epoch forward. A narrower re-run can therefore never
    // un-backfill it, and — the half that matters — can never falsely claim it either, since a run that did
    // not start at the epoch contributes `false` and simply leaves the stored marker alone.
    // MAX on the message count too, and for the same reason the cursor is: a channel only grows, so a
    // narrower read that was served fewer rows has not shrunk it — it simply did not walk it end to end.
    const count = messages ?? existing?.messages;
    channels[channel] = {
      cursor: existing === undefined || cursor > existing.cursor ? cursor : existing.cursor,
      fullHistory: fullHistory || existing?.fullHistory === true,
      ...(count !== undefined ? { messages: Math.max(count, existing?.messages ?? 0) } : {}),
    };
  }
  return { channels, version: 1 };
}

/**
 * Advance the per-channel watermark file to include `advances` (MAX-merged), written atomically.
 *
 * @param advances the per-channel cursors to merge in
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written path, or an error on write failure
 */
export function advanceSlackChannelWatermarks({
  advances,
  home = slopweaverHome(),
}: {
  advances: readonly ChannelWatermarkAdvance[];
  home?: string;
}): Result<{ path: string }, SlackCursorWriteError> {
  const path = stateHomePaths({ home }).corpus.slackChannelsWatermark;
  const merged = mergeChannelWatermarks({ current: readChannelWatermarkFile({ home }), incoming: advances });
  try {
    writeFileAtomic({ contents: `${JSON.stringify(merged, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err(SlackCursorWriteErrors.channelWatermarkFailed({ cause: error, path }));
  }
  return ok({ path });
}
