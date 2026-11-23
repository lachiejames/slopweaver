/**
 * The pure core of thread-reply recovery — checkpoint planning, raw-row filtering, and the coverage
 * accounting `recover.ts` (manual mode) and `recoverSweep.ts` (scheduled mode) both need but neither should
 * own, because a scanner mixing this with its own I/O is exactly how the two modes would drift.
 *
 * ## Why this exists at all
 *
 * `conversations.history` returns thread ROOTS only. Every reply living inside a thread is invisible to it,
 * so a candidate list built purely from history rows can never surface a tag that arrived as an ordinary
 * reply — which is most real conversations this bot is tagged in. Fixing that needs four things this
 * module gives a name to: which history rows are roots WORTH checking for replies right now
 * ({@link recoveryThreadHints}), which roots are DURABLY REMEMBERED so a reply arriving after the root has
 * scrolled out is still reachable ({@link recoveryRootRegistrations}), which raw rows returned by an
 * incremental `conversations.replies` walk are actually fresh, in-window candidates
 * ({@link recoveryReplyRows}), and — for the scheduled sweep only, where a root can age out of the
 * five-minute history window while still gaining new replies — which known threads are due for a bounded
 * background poll this sweep ({@link planRecoveryThreadChecks}).
 *
 * Registration and hinting are deliberately separate tests over the same rows. A hint is "this root has
 * replies NOW"; a registration is "this root exists, remember it". Conflating them is what lost a real tag
 * once — see {@link recoveryRootRegistrations}.
 *
 * ## A cursor namespace, deliberately SEPARATE from corpus ingestion's
 *
 * `../../corpus/slack/threadCursors.ts` already has durable per-thread cursors, and this module reuses its
 * pure primitives (`threadKey`, `newerReplies`, `latestReplyTs`) rather than reinventing them — but it never
 * shares or writes that cursor FILE. A corpus cursor means "safely committed to bronze"; a recovery
 * checkpoint here means "safely classified/captured". Sharing values would let either consumer acknowledge
 * work the other never performed.
 */
import { newerReplies, threadKey } from "../../corpus/slack/threadCursors.js";
import { isRecord } from "../../lib/parsers.js";
import type { RecordedAskIdentity } from "../ask/identity.js";
import { parseAssistantAnswerMetadata } from "../slack/messageMetadata.js";

/** One thread recovery has ever classified/captured — the checkpoint's own identity is the map key. */
export interface RecoveryThreadCheckpoint {
  /** The Slack decimal `ts` of the newest reply recovery has safely classified for this thread. */
  readonly cursorTs: string;
  /** When this thread was last polled at all, ISO-8601 — `undefined` for a checkpoint never yet checked. */
  readonly lastCheckedAtIso?: string;
}

/** `channel:threadTs → checkpoint` — recovery's OWN inventory, never the corpus ingestion cursor file. */
export type RecoveryThreadCheckpoints = Readonly<Record<string, RecoveryThreadCheckpoint>>;

/** One root, discovered in a history window, that advertises replies worth eventually checking. */
export interface RecoveryThreadHint {
  readonly channel: string;
  readonly threadTs: string;
  /** Slack's own `latest_reply` off the root row, when present and well-formed. */
  readonly latestReplyTs?: string;
}

const SLACK_TS_PATTERN = /^\d+\.\d{6}$/;

/** Whether a value is a well-formed Slack decimal timestamp. */
function isSlackTs(value: unknown): value is string {
  return typeof value === "string" && SLACK_TS_PATTERN.test(value);
}

/**
 * One raw row's own `ts`, when that row is a THREAD ROOT this module may key a thread by — a record whose
 * `ts` is a non-empty string and which is not a broadcast reply masquerading as a root (Slack's
 * `thread_broadcast` subtype: it appears in channel history looking like a root, but it is a REPLY, and its
 * own real root is what actually owns the thread).
 *
 * Shared by {@link recoveryThreadHints} and {@link recoveryRootRegistrations} so the two can never disagree
 * about what counts as a root. The registration path applies one FURTHER test of its own.
 */
function rootTsOf({ message }: { message: unknown }): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const ts = message["ts"];
  if (typeof ts !== "string" || ts.length === 0 || message["subtype"] === "thread_broadcast") {
    return undefined;
  }
  return ts;
}

/**
 * Every root, among a page of raw `conversations.history` (or `.replies`) rows, that is worth eventually
 * checking for replies — carries a positive `reply_count` or a well-formed `latest_reply`, and is a root by
 * {@link rootTsOf}'s test.
 *
 * Missing or malformed `latest_reply` is never treated as "nothing to check" — a root with a positive
 * `reply_count` but no readable `latest_reply` still becomes a hint, just with `latestReplyTs` absent, which
 * {@link planRecoveryThreadChecks} treats as "poll conservatively, never unchanged".
 *
 * A hint is the STRONG signal (this root has replies right now) and is deliberately narrower than
 * {@link recoveryRootRegistrations}'s durable one — a root is posted with zero replies, so a freshly-posted
 * root is never a hint, which is exactly why registration has to exist alongside this.
 *
 * @param channel the channel these rows came from
 * @param rawMessages the raw rows to scan
 * @returns every root hint found, in the rows' own order
 */
export function recoveryThreadHints({
  channel,
  rawMessages,
}: {
  channel: string;
  rawMessages: readonly unknown[];
}): readonly RecoveryThreadHint[] {
  const hints: RecoveryThreadHint[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message)) {
      continue;
    }
    const ts = rootTsOf({ message });
    if (ts === undefined) {
      continue;
    }
    const replyCount = message["reply_count"];
    const hasReplies = typeof replyCount === "number" && replyCount > 0;
    const latestReply = message["latest_reply"];
    if (!hasReplies && !isSlackTs(latestReply)) {
      continue;
    }
    hints.push({ channel, threadTs: ts, ...(isSlackTs(latestReply) ? { latestReplyTs: latestReply } : {}) });
  }
  return hints;
}

/**
 * Every root in a page of raw `conversations.history` rows, as a checkpoint the inventory can be SEEDED
 * with — the durable half of discovery, and the fix for the hole that once lost a real tag.
 *
 * ## Why registering an unread root is the whole point
 *
 * The inventory used to grow only from threads a sweep actually READ, and there are two independent reasons
 * a root is never read: it does not advertise replies when the window sees it (a root is posted with zero
 * replies, so {@link recoveryThreadHints} skips it), and it is not itself a candidate worth a thread read
 * (`recoverForegroundMessages.ts#outcomeForMessage`'s cheap-exclusion path covers over 98% of rows, and a root the BOT
 * posted is never a candidate at all). Once such a root leaves the five-minute history window it can never
 * be hinted again, so every later reply in it — including a direct tag of the bot — was unreachable by both
 * the foreground and the background path, permanently.
 *
 * MEASURED, and the incident this closes: the owner tagged the bot at `1789952379.135579`
 * (`slopweaver slack when` converts it) as a reply under root `1789775392.910229`
 * in `C0SYN000006` — the bot's OWN "fresh batch of vulnerability-fix PRs" post. A
 * complete sweep advanced the watermark past the tag without ever seeing it, because that
 * root's key was absent from the inventory while 315 other keys for the same channel were present.
 *
 * Registration costs no Slack call at all: the root row is already in the caller's hand.
 *
 * `cursorTs` is the root's OWN `ts`, which cannot skip a reply — Slack's `thread_ts` is the root's `ts` and
 * every reply is strictly greater, which is why {@link recoveryReplyRows} drops `ts === threadTs` outright.
 * `lastCheckedAtIso` is deliberately absent: nothing has polled this thread, and claiming otherwise would
 * sink it in {@link planRecoveryThreadChecks}'s rotation.
 *
 * A root whose `ts` is not the exact `seconds.micros` shape is SKIPPED rather than registered:
 * `RecoverySweepStateV2` (`recoverSchedule.ts`) validates every stored `cursorTs` against that pattern, so
 * one malformed value would make the whole durable state unreadable on the next boot.
 *
 * @param channel the channel these rows came from
 * @param rawMessages the raw history rows to scan
 * @returns one seed checkpoint per root found, keyed as `threadKey` writes it
 */
export function recoveryRootRegistrations({
  channel,
  rawMessages,
}: {
  channel: string;
  rawMessages: readonly unknown[];
}): RecoveryThreadCheckpoints {
  const registrations: Record<string, RecoveryThreadCheckpoint> = {};
  for (const message of rawMessages) {
    const ts = rootTsOf({ message });
    if (ts === undefined || !isSlackTs(ts)) {
      continue;
    }
    registrations[threadKey({ channel, threadTs: ts })] = { cursorTs: ts };
  }
  return registrations;
}

/**
 * Every EXACT-quality answer identity carried by a page of raw thread rows — the one shared implementation
 * `recover.ts` (manual mode) and `recoverSweep.ts` (scheduled mode) both used to duplicate.
 *
 * @param rawMessages the raw rows to scan (a fully-read or incrementally-read thread)
 * @returns every exact-quality answer identity found, in the rows' own order
 */
export function answerIdentitiesFromMessages({
  rawMessages,
}: {
  rawMessages: readonly unknown[];
}): readonly RecordedAskIdentity[] {
  const identities: RecordedAskIdentity[] = [];
  for (const message of rawMessages) {
    const read = parseAssistantAnswerMetadata({ value: isRecord(message) ? message["metadata"] : undefined });
    if (read.kind === "v2") {
      identities.push(read.metadata.askIdentity);
    }
  }
  return identities;
}

/**
 * The fresh, in-window, non-echoed reply rows from a page of raw thread rows — everything
 * {@link recover.candidateFromMessage} needs fed to it to turn a thread read into reply candidates.
 *
 * Three filters, all load-bearing: {@link newerReplies}'s strict lower bound (`ts > afterTs`, never `>=`, so
 * the cursor row itself — which Slack re-serves every time — is not re-classified); the sweep's own strict
 * upper bound (`ts < beforeTs`), so a reply posted after this sweep started is left for the NEXT sweep to
 * classify rather than half-processed now; and de-duplication by `ts`, because Slack repeats the thread
 * PARENT across every page of a real multi-page thread (`pagination.test.ts` records this), and the parent
 * itself (`ts === threadTs`) is dropped outright — it is never a reply.
 *
 * @param afterTs the strict lower bound — a recovery checkpoint's cursor, or `"0"` for a thread never checked
 * @param beforeTs the strict upper bound — the sweep's own `window.latestExclusiveTs`
 * @param rawMessages the raw rows from a full or incremental thread read
 * @param threadTs the thread's own root timestamp, so the echoed parent can be dropped
 * @returns the fresh reply rows, in the rows' own order, de-duplicated by `ts`
 */
export function recoveryReplyRows({
  afterTs,
  beforeTs,
  rawMessages,
  threadTs,
}: {
  afterTs: string;
  beforeTs: string;
  rawMessages: readonly unknown[];
  threadTs: string;
}): readonly unknown[] {
  const tagged: { readonly ts: string; readonly message: unknown }[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message)) {
      continue;
    }
    const ts = message["ts"];
    if (typeof ts !== "string" || ts.length === 0 || ts === threadTs) {
      continue;
    }
    tagged.push({ message, ts });
  }
  const fresh = newerReplies({ afterTs, replies: tagged });
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const row of fresh) {
    if (Number(row.ts) >= Number(beforeTs) || seen.has(row.ts)) {
      continue;
    }
    seen.add(row.ts);
    rows.push(row.message);
  }
  return rows;
}

/**
 * Seed recovery's OWN checkpoint inventory with additional thread KEYS only, from corpus ingestion's
 * already-known thread set — never its cursor VALUES. Copying a corpus cursor value could skip a reply the
 * corpus already ingested but recovery never classified; seeding only the key and bootstrapping its cursor
 * at the same lower bound every other bootstrap thread starts from carries no such risk.
 *
 * @param corpusKeys every `channel:threadTs` key corpus ingestion's own thread-cursor store already knows
 * @param existing recovery's own checkpoints so far
 * @param bootstrapCursorTs the cursor every newly-seeded key starts at
 * @returns `existing`, plus one freshly-seeded checkpoint per corpus key `existing` did not already have
 */
export function seedThreadCheckpointKeys({
  corpusKeys,
  existing,
  bootstrapCursorTs,
}: {
  corpusKeys: readonly string[];
  existing: RecoveryThreadCheckpoints;
  bootstrapCursorTs: string;
}): RecoveryThreadCheckpoints {
  const seeded: Record<string, RecoveryThreadCheckpoint> = { ...existing };
  for (const key of corpusKeys) {
    if (!(key in seeded)) {
      seeded[key] = { cursorTs: bootstrapCursorTs };
    }
  }
  return seeded;
}
