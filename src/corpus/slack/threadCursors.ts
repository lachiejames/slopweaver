/**
 * Per-thread incremental reply state — a durable `channel:threadTs → {ts, replyCount}` map so a refresh
 * re-reads only NEW thread replies instead of re-pulling every thread's full history each window. Kept
 * SEPARATE from the source-level watermark (a thread can gain a reply long after the parent message's
 * timestamp, which the source watermark alone would miss).
 *
 * ## Why the stored value carries a COUNT as well as a cursor
 *
 * The cursor alone answers "has anything arrived since?" and nothing else. `conversations.history` reports
 * `reply_count` on every thread root it returns, so storing the count we last agreed with turns the same
 * free field into a DELETION detector: a thread whose `latest_reply` has not moved but whose `reply_count`
 * fell has lost a reply, which a cursor-bounded per-thread poll (`oldest=cursor` returns only newer rows)
 * can never see. `./threadOracle.ts` is what reads both.
 *
 * ## The file has a version, and the old shape is MIGRATED rather than tolerated
 *
 * `.slack-threads.json` was `channel:threadTs → lastReplyTs`, a flat map of strings. The reader below used
 * to degrade anything it did not recognise to `{}` — which for a shape change is the worst possible
 * failure, because an empty cursor map is indistinguishable from "no thread has ever been read" and would
 * silently re-crawl all of them. So the flat-string shape is detected and lifted explicitly, the new shape is
 * versioned, and only a genuinely corrupt file degrades — loudly, via {@link ThreadCursorRead}'s `warnings`,
 * so a caller can say so rather than quietly re-crawling a workspace.
 *
 * Pure core (`threadKey` / `newerReplies` / `latestReplyTs` / `isSlackTs` / `migrateThreadCursorFile`) is
 * unit-tested; the read/write edge persists `$SLOPWEAVER_HOME/corpus/.slack-threads.json` atomically. This
 * is a sanctioned local-state seam (see `src/admit/coverage.ts`). NOTE: this is only the INGEST cursor — the
 * owed/attention-queue semantics (human-vs-bot, dismissed, notify) are deliberately NOT here; they belong to
 * the operator loop.
 */
import { readFileSync } from "node:fs";
import { slopweaverHome } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type SlackCursorWriteError, SlackCursorWriteErrors } from "./cursorWriteErrors.js";

/** Slack's decimal message timestamp, `epochSeconds.micros`. */
const SLACK_TS_PATTERN = /^\d+\.\d{6}$/;

/**
 * Whether an unvalidated value is a well-formed Slack message timestamp. Pure.
 *
 * The one definition of the shape, shared rather than re-declared: the corpus lane and the live recovery
 * lanes all key thread identity on it, and three private regexes are three chances for one of them to drift.
 *
 * Positional because it must be: TypeScript's TS1230 forbids destructuring in a type-predicate signature,
 * which is the compiler deciding this parameter list rather than the author.
 *
 * @param value the unvalidated value
 * @returns true when it is a `epochSeconds.micros` decimal string
 */
export function isSlackTs(value: unknown): value is string {
  return typeof value === "string" && SLACK_TS_PATTERN.test(value);
}

/**
 * One thread's stored ingest state.
 *
 * `replyCount` is OPTIONAL and its absence is a real state, not a zero: an entry migrated from the
 * flat-string file has a cursor but no count we ever agreed with, and treating that as a mismatch would poll
 * every known thread once on the first refresh after the migration — the exact cost the oracle exists to
 * remove. `./threadOracle.ts` therefore reads an absent count as "unknown, so not a mismatch", records the
 * observed one, and has the deletion detector armed from the next refresh onward.
 */
export interface ThreadCursor {
  /** The Slack `ts` of the newest reply this thread has been ingested through. */
  readonly ts: string;
  /** The `reply_count` Slack last reported for this thread, when one has ever been observed. */
  readonly replyCount?: number;
}

/** `channel:threadTs → this thread's stored ingest state`. */
export type ThreadCursors = Readonly<Record<string, ThreadCursor>>;

/** The on-disk version of the cursor file this module writes. */
const THREAD_CURSOR_FILE_VERSION = 2;

/**
 * The store key for one thread.
 *
 * @param channel the channel id
 * @param threadTs the parent message's ts, which is the thread's identity in Slack
 * @returns the store key
 */
export function threadKey({ channel, threadTs }: { channel: string; threadTs: string }): string {
  return `${channel}:${threadTs}`;
}

/**
 * Replies strictly newer than `afterTs` (undefined ⇒ all) — drops the inclusive-boundary re-fetch.
 *
 * @param replies the replies as fetched
 * @param afterTs the stored cursor, or undefined on a first crawl
 * @returns only STRICTLY newer replies — Slack's `oldest` bound is inclusive, so the cursor message itself
 *   comes back every time and would be re-ingested without this
 */
export function newerReplies<T extends { readonly ts: string }>({
  replies,
  afterTs,
}: {
  replies: readonly T[];
  afterTs: string | undefined;
}): readonly T[] {
  if (afterTs === undefined) {
    return replies;
  }
  return replies.filter((reply) => Number(reply.ts) > Number(afterTs));
}

/**
 * The newest reply ts (numeric max) across `replies` + the `current` cursor — the next stored cursor.
 *
 * @param current the cursor already stored, kept in the running so a fetch that returned nothing new cannot
 *   move the cursor backwards
 * @param replies the replies just fetched
 * @returns the cursor to store, or undefined when there is nothing to store at all. Compared NUMERICALLY,
 *   because a Slack ts sorts wrongly as a string once the seconds roll a digit
 */
export function latestReplyTs({
  current,
  replies,
}: {
  current: string | undefined;
  replies: readonly { readonly ts: string }[];
}): string | undefined {
  let best = current;
  for (const reply of replies) {
    if (best === undefined || Number(reply.ts) > Number(best)) {
      best = reply.ts;
    }
  }
  return best;
}

/**
 * Merge per-channel thread-cursor updates onto a base map (base unmutated). Pure — the resume-cursor
 * bookkeeping is testable apart from the crawl.
 *
 * @param base the stored cursors going in
 * @param updates the newly-advanced cursors
 * @returns the merged cursor map
 */
export function mergeCursorUpdates({ base, updates }: { base: ThreadCursors; updates: ThreadCursors }): ThreadCursors {
  return { ...base, ...updates };
}

/** What {@link migrateThreadCursorFile} made of an unvalidated parsed file. */
export interface ThreadCursorRead {
  readonly cursors: ThreadCursors;
  /** How the file on disk was understood — `"absent"` covers both no file and an unparseable one. */
  readonly shape: "v2" | "flat-string" | "absent" | "unrecognised";
  readonly warnings: readonly string[];
}

/** Lift the flat `key → lastReplyTs` map into the versioned shape (no count is known for any of it). */
function liftFlatCursors({ raw }: { raw: Record<string, unknown> }): ThreadCursors {
  const cursors: Record<string, ThreadCursor> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.length > 0) {
      cursors[key] = { ts: value };
    }
  }
  return cursors;
}

/** Read the versioned `threads` map, dropping any entry without a usable `ts`. */
function readVersionedCursors({ raw }: { raw: unknown }): ThreadCursors {
  if (!isRecord(raw)) {
    return {};
  }
  const cursors: Record<string, ThreadCursor> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value["ts"] !== "string" || value["ts"].length === 0) {
      continue;
    }
    const replyCount = value["replyCount"];
    cursors[key] = {
      ts: value["ts"],
      ...(typeof replyCount === "number" && Number.isFinite(replyCount) ? { replyCount } : {}),
    };
  }
  return cursors;
}

/**
 * Understand one parsed `.slack-threads.json` — versioned, flat-string, or neither. Pure.
 *
 * The flat-string branch is a MIGRATION, not tolerance: the old file is a flat `key → tsString` map, so a value
 * that is a string is positive evidence of the old shape rather than a guess, and every such entry is lifted
 * with its count left unknown. Anything matching neither shape returns `"unrecognised"` WITH a warning,
 * because the alternative — an empty map — reads downstream as "no thread has ever been read" and re-crawls
 * every thread in the workspace.
 *
 * @param raw the parsed file contents, of unvalidated shape
 * @returns the cursors, which shape they came from, and any warning worth surfacing
 */
export function migrateThreadCursorFile({ raw }: { raw: unknown }): ThreadCursorRead {
  if (!isRecord(raw)) {
    return { cursors: {}, shape: "unrecognised", warnings: ["slack thread cursors: file is not an object"] };
  }
  if (raw["version"] === THREAD_CURSOR_FILE_VERSION) {
    return { cursors: readVersionedCursors({ raw: raw["threads"] }), shape: "v2", warnings: [] };
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return { cursors: {}, shape: "absent", warnings: [] };
  }
  if (entries.every(([, value]) => typeof value === "string")) {
    return { cursors: liftFlatCursors({ raw }), shape: "flat-string", warnings: [] };
  }
  return {
    cursors: {},
    shape: "unrecognised",
    warnings: [
      "slack thread cursors: file matches neither the versioned nor the flat-string shape — every thread will be re-read",
    ],
  };
}

/**
 * Read the persisted thread cursors, migrating a flat-string file in place (in memory).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the stored cursors, the shape they were read from, and any warning worth surfacing
 */
function readThreadCursorFile({ home = slopweaverHome() }: { home?: string } = {}): ThreadCursorRead {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stateHomePaths({ home }).corpus.slackThreads, "utf8"));
  } catch {
    return { cursors: {}, shape: "absent", warnings: [] };
  }
  return migrateThreadCursorFile({ raw });
}

/**
 * Read the persisted thread cursors. The convenience shape for callers that only want the map.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the stored cursors, or `{}` when none
 */
export function readThreadCursors({ home = slopweaverHome() }: { home?: string } = {}): ThreadCursors {
  return readThreadCursorFile({ home }).cursors;
}

/**
 * Persist the thread cursors atomically and durably, in the versioned shape.
 *
 * @param cursors the full cursor map to write
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written path, or an error on write failure
 */
export function writeThreadCursors({
  cursors,
  home = slopweaverHome(),
}: {
  cursors: ThreadCursors;
  home?: string;
}): Result<{ path: string }, SlackCursorWriteError> {
  const path = stateHomePaths({ home }).corpus.slackThreads;
  const file = { threads: cursors, version: THREAD_CURSOR_FILE_VERSION };
  try {
    writeFileAtomic({ contents: `${JSON.stringify(file, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err(SlackCursorWriteErrors.threadCursorsFailed({ cause: error, path }));
  }
  return ok({ path });
}
