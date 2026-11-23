/**
 * How a sweep spends its bounded background thread-read budget — which of the threads recovery's own
 * inventory knows about get polled this pass, in what order, and what the pass reports about the rest.
 * Pure: `recoverThreads.ts` owns what a thread checkpoint IS and how raw rows are read; this module owns
 * only the choosing, and `recoverForeground.ts` and `recoverBackground.ts` own the reads themselves.
 *
 * The rotation is two lanes rather than one queue, and that is the whole point of the file. A single
 * oldest-check-first queue is what starved a real tag: 16,251 never-checked bootstrap seeds
 * outranked every already-checked thread, so a thread polled once was never polled again inside any
 * plausible uptime. Threads whose ROOT is recent take most of each sweep, the older tail takes the rest,
 * and either lane's unspent share spills to the other so neither can starve.
 */
import { threadKey } from "../../corpus/slack/threadCursors.js";
import { compareStrings } from "../../lib/compare.js";
import type { RecoveryThreadCheckpoints, RecoveryThreadHint } from "./recoverThreads.js";

/** What one sweep's thread-checkpoint accounting produced — the `threadCoverage` a caller reports. */
export interface RecoveryThreadCoverage {
  /** How many distinct threads recovery's own inventory now knows about, after this sweep. */
  readonly known: number;
  /** How many threads were fully read via the existing foreground fast path this sweep. */
  readonly foregroundReads: number;
  /** How many old/background threads were incrementally polled this sweep. */
  readonly backgroundReads: number;
  /** How many visible roots needed no reply call because their own `latest_reply` proved nothing changed. */
  readonly skippedByLatestReply: number;
  /** How many due background threads the budget could not reach this sweep — still in rotation, oldest-first. */
  readonly deferred: number;
}

/** One background thread the planner selected to poll this sweep, and the cursor to poll it from. */
export interface RecoveryThreadCheck {
  readonly channel: string;
  readonly threadTs: string;
  /** The `oldest` bound to poll from — the existing checkpoint's cursor, or `"0"` for a thread never checked. */
  readonly oldest: string;
}

/** What {@link planRecoveryThreadChecks} decided this sweep. */
export interface RecoveryThreadCheckPlan {
  /** Threads to poll now, already cut to the sweep's budget, in priority order. */
  readonly checks: readonly RecoveryThreadCheck[];
  /** Visible roots skipped because their own `latest_reply` proved nothing changed since the last check. */
  readonly skippedByLatestReply: number;
  /** Due threads the budget could not reach this sweep. */
  readonly deferred: number;
}

/** A checkpoint's own identity, split back out of a `threadKey` — channel ids never contain `:`. */
function splitThreadKey({ key }: { key: string }): { readonly channel: string; readonly threadTs: string } {
  const separator = key.indexOf(":");
  return { channel: key.slice(0, separator), threadTs: key.slice(separator + 1) };
}

/** One thread's due-ness, computed once so sorting stays a plain comparison. */
interface DueThread {
  readonly key: string;
  readonly channel: string;
  readonly threadTs: string;
  readonly oldest: string;
  readonly observedNewer: boolean;
  readonly neverChecked: boolean;
  readonly lastCheckedAtIso: string | undefined;
  /** Whether this thread's ROOT is inside {@link RECENT_ROOT_HORIZON_HOURS} — which LANE it competes in. */
  readonly recentRoot: boolean;
}

/** The freshest hint per thread key — Slack can repeat a root row, so the latest signal wins. */
function hintsByKey({ hints }: { hints: readonly RecoveryThreadHint[] }): ReadonlyMap<string, RecoveryThreadHint> {
  const hintByKey = new Map<string, RecoveryThreadHint>();
  for (const hint of hints) {
    const key = threadKey({ channel: hint.channel, threadTs: hint.threadTs });
    const existing = hintByKey.get(key);
    if (
      existing?.latestReplyTs === undefined ||
      (hint.latestReplyTs !== undefined && Number(hint.latestReplyTs) > Number(existing.latestReplyTs))
    ) {
      hintByKey.set(key, hint);
    }
  }
  return hintByKey;
}

/**
 * Every thread key due for a background check this sweep, and how many visible roots the `latest_reply`
 * fast path already proved unchanged — every VISIBLE hint not covered by the foreground path or the
 * fast-path skip, UNION every OLD known checkpoint whose root has left the current history window.
 *
 * @param checkpoints recovery's own known-thread inventory
 * @param foregroundKeys thread keys already fully read via the existing foreground fast path this sweep
 * @param hintByKey the freshest hint per thread key, from {@link hintsByKey}
 * @returns the due keys plus how many were skipped by the `latest_reply` fast path
 */
function dueKeys({
  checkpoints,
  foregroundKeys,
  hintByKey,
}: {
  checkpoints: RecoveryThreadCheckpoints;
  foregroundKeys: ReadonlySet<string>;
  hintByKey: ReadonlyMap<string, RecoveryThreadHint>;
}): { readonly keys: ReadonlySet<string>; readonly skippedByLatestReply: number } {
  let skippedByLatestReply = 0;
  const keys = new Set<string>();
  for (const [key, hint] of hintByKey) {
    if (foregroundKeys.has(key)) {
      continue;
    }
    const checkpoint = checkpoints[key];
    if (
      checkpoint !== undefined &&
      hint.latestReplyTs !== undefined &&
      Number(hint.latestReplyTs) <= Number(checkpoint.cursorTs)
    ) {
      skippedByLatestReply += 1;
      continue;
    }
    keys.add(key);
  }
  for (const key of Object.keys(checkpoints)) {
    if (!hintByKey.has(key) && !foregroundKeys.has(key)) {
      keys.add(key);
    }
  }
  return { keys, skippedByLatestReply };
}

/**
 * How recent a thread's ROOT must be for it to compete in the priority lane, in hours.
 *
 * Seven days, and it is MEASURED rather than picked. Over every in-thread tag this install has ever
 * captured — a `captured` row whose `messageTs` differs from its `threadTs` — the gap from the thread's
 * root to the tag itself. Reproduce it with:
 *
 * ```
 * jq -rs 'map(select(.kind=="captured" and .threadTs != null and .messageTs != .threadTs))
 *   | map(((.messageTs|tonumber) - (.threadTs|tonumber))/3600) as $g
 *   | {n:($g|length), within_24h:($g|map(select(.<=24))|length), within_72h:($g|map(select(.<=72))|length),
 *      within_168h:($g|map(select(.<=168))|length), within_336h:($g|map(select(.<=336))|length),
 *      within_720h:($g|map(select(.<=720))|length), max_hours:($g|max|floor)}' \
 *   "$SLOPWEAVER_HOME/live/slack/asks.jsonl"
 * ```
 *
 * Measured over n=134: 88 tags within 24h, 113 within 72h, **122 within 168h**, 124 within
 * 336h, 131 within 720h, the longest 1,180h. The knee is at seven days — the second week buys two more
 * tags out of 134. Past the horizon a thread is not DROPPED, which would recreate the old-thread blind
 * spot this whole module exists to close; it moves to the other lane and keeps a share of every budget.
 *
 * @internal
 */
export const RECENT_ROOT_HORIZON_HOURS = 168;

/** {@link RECENT_ROOT_HORIZON_HOURS} as whole Slack-ts seconds, so recency is one numeric comparison. */
const RECENT_ROOT_HORIZON_SECONDS = RECENT_ROOT_HORIZON_HOURS * 3600;

/** A due thread's own channel and root ts — the hint when one exists, else recovered from the key itself. */
function identityOf({ hint, key }: { hint: RecoveryThreadHint | undefined; key: string }): {
  readonly channel: string;
  readonly threadTs: string;
} {
  if (hint === undefined) {
    return splitThreadKey({ key });
  }
  return { channel: hint.channel, threadTs: hint.threadTs };
}

/** One due key, resolved to its full sortable/pollable shape. */
function toDueThread({
  key,
  checkpoints,
  hintByKey,
  nowTs,
}: {
  key: string;
  checkpoints: RecoveryThreadCheckpoints;
  hintByKey: ReadonlyMap<string, RecoveryThreadHint>;
  nowTs: string;
}): DueThread {
  const hint = hintByKey.get(key);
  const checkpoint = checkpoints[key];
  const identity = identityOf({ hint, key });
  const checkpointCursorTs = checkpoint === undefined ? "0" : checkpoint.cursorTs;
  const observedNewer =
    checkpoint !== undefined &&
    hint !== undefined &&
    (hint.latestReplyTs === undefined || Number(hint.latestReplyTs) > Number(checkpoint.cursorTs));
  return {
    channel: identity.channel,
    key,
    lastCheckedAtIso: checkpoint?.lastCheckedAtIso,
    neverChecked: checkpoint?.lastCheckedAtIso === undefined,
    observedNewer,
    oldest: checkpointCursorTs,
    recentRoot: Number(nowTs) - Number(identity.threadTs) <= RECENT_ROOT_HORIZON_SECONDS,
    threadTs: identity.threadTs,
  };
}

/**
 * Every thread that needs a background check this sweep, and how many visible roots the `latest_reply` fast
 * path already proved unchanged — everything before the budget cut.
 *
 * @param checkpoints recovery's own known-thread inventory
 * @param foregroundKeys thread keys already fully read via the existing foreground fast path this sweep
 * @param hints every root-with-replies hint discovered in this sweep's history window
 * @param nowTs the sweep's own upper bound as a Slack decimal `ts`, for the root-recency test
 * @returns the due threads (unsorted) plus how many were skipped by the `latest_reply` fast path
 */
function dueThreads({
  checkpoints,
  foregroundKeys,
  hints,
  nowTs,
}: {
  checkpoints: RecoveryThreadCheckpoints;
  foregroundKeys: ReadonlySet<string>;
  hints: readonly RecoveryThreadHint[];
  nowTs: string;
}): { readonly due: readonly DueThread[]; readonly skippedByLatestReply: number } {
  const hintByKey = hintsByKey({ hints });
  const { keys, skippedByLatestReply } = dueKeys({ checkpoints, foregroundKeys, hintByKey });
  const due = Array.from(keys).map((key) => toDueThread({ checkpoints, hintByKey, key, nowTs }));
  return { due, skippedByLatestReply };
}

/** A due thread's priority tier: `0` observed-newer, `1` never-checked, `2` everything else. */
function tierOf({ thread }: { thread: DueThread }): 0 | 1 | 2 {
  if (thread.observedNewer) {
    return 0;
  }
  return thread.neverChecked ? 1 : 2;
}

/** Compares two `lastCheckedAtIso` values — `undefined` (never checked) sorts before any real instant. */
function compareLastCheckedAtIso({ left, right }: { left: string | undefined; right: string | undefined }): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return left < right ? -1 : 1;
}

/** Deterministic priority order: observed-newer first, never-checked second, then oldest check, then key. */
function compareDue(left: DueThread, right: DueThread): number {
  const tierDiff = tierOf({ thread: left }) - tierOf({ thread: right });
  if (tierDiff !== 0) {
    return tierDiff;
  }
  const checkedDiff = compareLastCheckedAtIso({ left: left.lastCheckedAtIso, right: right.lastCheckedAtIso });
  if (checkedDiff !== 0) {
    return checkedDiff;
  }
  return compareStrings({ a: left.key, b: right.key });
}

/** A hard ceiling on background thread reads per sweep — half the recorded internal-app Tier-3 floor. */
const MAX_BACKGROUND_THREAD_READS_PER_SWEEP = 25;

/**
 * The background reads every sweep keeps however busy its foreground was — two, one per lane, so neither the recent
 * lane nor the old-root tail can be starved by a sweep the foreground filled. Two `conversations.replies` calls over a
 * Tier-3 (50/min) method is no measurable spend.
 */
const MIN_BACKGROUND_THREAD_READS_PER_SWEEP = 2;

/**
 * The bounded, deterministic background-read budget for one sweep — never an age horizon, because dropping a
 * thread after N days recreates the exact old-thread blind spot this feature exists to close.
 *
 * The ceiling is the WHOLE rule, and it used to be throttled further by a fraction of the sweep's history
 * rows. That tied background work to a quantity with no relationship to how many KNOWN threads are due, and
 * it collapsed to zero on exactly the quiet sweep where the background lane is the only path a reply can
 * arrive by — the one-read floor underneath it was the symptom, not the fix. Ceiling arithmetic: 25
 * `conversations.replies` calls spread across a five-minute sweep is 5/min against a Tier-3 (50/min)
 * method, which is the floor this constant was already chosen against. It is unrelated to the 34-minute
 * measurement in `../../cli/commands/listen/scheduledRecover.ts`'s header — that was channel DISCOVERY
 * breadth across 542 conversations, not thread polls.
 *
 * The foreground's reads come off the ceiling, but never below {@link MIN_BACKGROUND_THREAD_READS_PER_SWEEP}: a sweep
 * whose foreground spent all 25 every time would otherwise poll no known thread at all, so the bot's own threads
 * (`./recoverOwnThreads.ts`) would sit registered and never be read.
 *
 * @param foregroundReads how many threads the foreground fast path already fully read this sweep
 * @returns the number of background checks this sweep may perform
 */
function backgroundBudget({ foregroundReads }: { foregroundReads: number }): number {
  return Math.max(MIN_BACKGROUND_THREAD_READS_PER_SWEEP, MAX_BACKGROUND_THREAD_READS_PER_SWEEP - foregroundReads);
}

/**
 * The share of one sweep's background budget reserved for threads whose root is inside
 * {@link RECENT_ROOT_HORIZON_HOURS}, before either lane's unspent share spills to the other.
 *
 * Four fifths, and the asymmetry is the point rather than a preference: the measurement on
 * {@link RECENT_ROOT_HORIZON_HOURS} puts 91% of this install's real in-thread tags inside the horizon,
 * while the long tail is the overwhelming majority of the INVENTORY — 16,251 of 16,298 checkpoints at
 * the measurement were corpus seeds that had never been polled. An even split hands the budget to the
 * backlog and starves the lane tags actually arrive in; reserving the tail nothing at all would freeze it
 * forever. The spill in {@link planRecoveryThreadChecks} means neither share is ever wasted when its own
 * lane has fewer threads due than it was given.
 */
const RECENT_LANE_BUDGET_FRACTION = 0.8;

/**
 * Plan which background threads to poll this sweep — the scheduled sweep's OWN independent inventory,
 * separate from the foreground fast path `recoverForeground.ts` already runs per shallow candidate.
 *
 * ## Two lanes, because one queue starves the threads that matter
 *
 * {@link compareDue} orders never-checked threads strictly ahead of every already-checked one. With one
 * queue that is fatal at this install's scale: 16,251 never-checked pre-24-Aug corpus seeds against a
 * ceiling of {@link MAX_BACKGROUND_THREAD_READS_PER_SWEEP} means roughly 650 sweeps — about 54 hours of
 * CONTINUOUS loop uptime, which this install does not have — before an already-checked thread is looked at
 * again. So a thread polled once on the day its root appeared was then never polled again, and a tag
 * landing in it two days later was unreachable. Registering more roots (see
 * {@link recoveryRootRegistrations}) makes that worse, not better.
 *
 * The lanes fix it: threads whose ROOT is inside {@link RECENT_ROOT_HORIZON_HOURS} compete for
 * {@link RECENT_LANE_BUDGET_FRACTION} of the budget and the long tail competes for the rest, each ordered
 * by {@link compareDue} exactly as before, and either lane's unspent share spills to the other so nothing
 * is wasted. The backlog can no longer starve the lane real tags arrive in, and the backlog still drains.
 *
 * @param checkpoints recovery's own known-thread inventory, before this sweep
 * @param foregroundKeys thread keys (see `threadKey`) already fully read via the foreground fast path
 * @param hints every root-with-replies hint discovered in this sweep's history window
 * @param nowTs the sweep's own exclusive upper bound as a Slack decimal `ts` — what root recency is against
 * @returns the threads to poll now, cut to budget, plus the skip/deferred accounting
 */
export function planRecoveryThreadChecks({
  checkpoints,
  foregroundKeys,
  hints,
  nowTs,
}: {
  checkpoints: RecoveryThreadCheckpoints;
  foregroundKeys: ReadonlySet<string>;
  hints: readonly RecoveryThreadHint[];
  nowTs: string;
}): RecoveryThreadCheckPlan {
  const { due, skippedByLatestReply } = dueThreads({ checkpoints, foregroundKeys, hints, nowTs });
  const sorted = due.toSorted(compareDue);
  const budget = backgroundBudget({ foregroundReads: foregroundKeys.size });
  const recent = sorted.filter((thread) => thread.recentRoot);
  const tail = sorted.filter((thread) => !thread.recentRoot);
  const tailFloor = Math.min(tail.length, budget >= 2 ? 1 : 0);
  const recentCeiling = Math.min(Math.ceil(budget * RECENT_LANE_BUDGET_FRACTION), budget - tailFloor);
  const recentShare = Math.min(recent.length, recentCeiling);
  const fromTail = tail.slice(0, budget - recentShare);
  const fromRecent = recent.slice(0, budget - fromTail.length);
  const selected = [...fromRecent, ...fromTail].toSorted(compareDue);
  return {
    checks: selected.map((thread) => ({ channel: thread.channel, oldest: thread.oldest, threadTs: thread.threadTs })),
    deferred: sorted.length - selected.length,
    skippedByLatestReply,
  };
}
