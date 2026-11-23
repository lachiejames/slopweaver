/**
 * The effectful, all-visible scan half of scheduled recovery — walk every discovered channel over a
 * {@link RecoveryWindow}, classification-ready `RecoveryCandidate`s out. Pure classification stays in
 * `recover.ts`, what a checkpoint IS in `recoverThreads.ts` and which threads to poll in
 * `recoverThreadPlan.ts`; the scoring both phases share is `recoverShared.ts`, and the phases themselves are
 * `recoverForeground.ts` and `recoverBackground.ts`. This module composes them and owns the completeness
 * accounting over both.
 *
 * A channel contributes candidates only when its ENTIRE history window and every candidate's thread read
 * completely — matching `recover.ts`'s own doc: a channel this scan could only partially see must refuse to
 * contribute, never silently report "nothing unanswered" over the part it happened to read. A single
 * channel's failure is recorded and the scan moves on; only the caller decides what an incomplete workspace
 * means for the durable watermark (never advance it on anything but a fully complete scan).
 *
 * Two phases, both real: the FOREGROUND fast path reads a full thread for any shallow candidate that
 * classification cannot already exclude cheaply — the same 98%-of-reads-avoided shortcut this module always
 * had. The BACKGROUND phase independently inventories threads, including ones the foreground path never
 * touched because the root itself did not address the bot, and polls a bounded, budgeted set of them — the
 * fix for a reply landing in a thread whose root has already scrolled out of the five-minute history window.
 *
 * That inventory has TWO sources, and the second one is why a real tag was once lost.
 * `recoveryThreadHints` supplies the strong signal — a root advertising replies right now — but a root is
 * posted with no replies, so a root nothing had a reason to read was never remembered at all and its later
 * replies were permanently unreachable. `recoveryRootRegistrations` supplies the durable one: EVERY root a
 * history window shows is written into the checkpoint inventory, at no extra Slack call, so the background
 * phase can still reach it a day later.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import { threadKey } from "../../corpus/slack/threadCursors.js";
import type { RecoveryCandidate } from "./recover.js";
import { runBackgroundChecks } from "./recoverBackground.js";
import { type ForegroundScan, type RecoveryProgress, scanAllChannels } from "./recoverForeground.js";
import type { ClassificationContext } from "./recoverForegroundMessages.js";
import type { RecoveryWindow } from "./recoverSchedule.js";
import type { RecoveryChannelExclusion, RecoveryCoverageFailure, RecoveryGoneThread } from "./recoverShared.js";
import {
  planRecoveryThreadChecks,
  type RecoveryThreadCheckPlan,
  type RecoveryThreadCoverage,
} from "./recoverThreadPlan.js";
import type { RecoveryThreadCheckpoints } from "./recoverThreads.js";

/**
 * Which discovered channels are worth scanning at all: every DM and group DM, every PRIVATE channel, and
 * every public channel the token has actually JOINED. `conversations.list` also lists a public channel the
 * token merely has read-VISIBILITY of via the `channels:read` scope — never joined, never able to read a
 * single message from — and scanning those is pure waste: `fetchCompleteSlackHistory` would only ever fail
 * there with `not_in_channel`. Measured against the real workspace this bot runs in: 542 discovered, only 81
 * actionable (24 joined public + 13 private + 44 DM) — discarding the rest is most of the difference between
 * a 34-minute sweep and a fast one. Pure.
 *
 * **A private conversation is kept on its CLASS, not on its membership flag**, and that is the difference
 * between a drop and a silent one. Slack only ever lists a private channel, group DM or DM the token is
 * actually in — visibility and membership are the same thing off this lane — so a row of one of those
 * classes with `is_member` absent is an anomaly, not a non-member, and filtering it out would delete the
 * exact conversation class a widened recovery pass exists to reach without leaving a trace anywhere. Kept,
 * it is attempted, and a genuine `not_in_channel` becomes that channel's own recorded coverage failure
 * rather than a blind spot. On this workspace the flag is always there — verify with
 * `slopweaver slack probe --method conversations.list types=private_channel limit=200 --bot --expect channels.0.is_member=true`
 * — so this changes no real count and costs nothing; it is what makes the filter fail toward reading.
 *
 * @param channels every channel `fetchCompleteSlackChannels` discovered
 * @returns only the channels this token can actually read history from
 */
export function actionableChannels({ channels }: { channels: readonly SlackChannelRef[] }): readonly SlackChannelRef[] {
  return channels.filter((c) => c.isIm === true || c.isMpim === true || c.isPrivate === true || c.isMember === true);
}

/** What a whole all-visible workspace scan found. */
export interface RecoveryWorkspaceResult {
  /** Whether EVERY discovered channel's window and every candidate's thread read completely. */
  readonly complete: boolean;
  readonly discoveredChannels: number;
  /** How many channels contributed candidates (a channel with any failure contributes none). */
  readonly completedChannels: number;
  readonly candidates: readonly RecoveryCandidate[];
  readonly failures: readonly RecoveryCoverageFailure[];
  /**
   * Channels this sweep did not read because they are out of scope, not because reading them failed. A
   * non-empty list does NOT make the sweep incomplete — see {@link RecoveryChannelExclusion}. It is reported
   * so an operator can see WHICH channel the bot is missing and decide to invite it.
   */
  readonly excludedChannels: readonly RecoveryChannelExclusion[];
  /**
   * Threads whose root Slack no longer has — see `recoverShared.ts#goneThread`. Like an excluded channel, a
   * non-empty list does NOT make the sweep incomplete; unlike one, each is RETIRED from
   * {@link threadCheckpoints} when the sweep is complete, because a thread that no longer exists has no cursor
   * worth resuming from. A partial sweep retires nothing — its inventory is never persisted anyway — and nor
   * does a channel this sweep excluded, which keeps its checkpoints for a re-invite.
   */
  readonly goneThreads: readonly RecoveryGoneThread[];
  /** Recovery's own thread-checkpoint inventory, after this sweep's foreground and background reads. */
  readonly threadCheckpoints: RecoveryThreadCheckpoints;
  /** How this sweep spent its thread-read budget — see `recoverThreadPlan.ts#RecoveryThreadCoverage`. */
  readonly threadCoverage: RecoveryThreadCoverage;
}

/**
 * One exclusion per channel, first reason wins — the background phase can prove the same channel unreadable
 * once per remembered thread (seven times on one channel, measured), and a report that names it seven times
 * says nothing the first line did not.
 *
 * @param exclusions every exclusion the foreground and background phases produced, in order
 * @returns the same list with repeats of a channel dropped
 */
function dedupeExclusions({
  exclusions,
}: {
  exclusions: readonly RecoveryChannelExclusion[];
}): readonly RecoveryChannelExclusion[] {
  const seen = new Set<string>();
  return exclusions.filter((exclusion) => {
    if (seen.has(exclusion.channel)) {
      return false;
    }
    seen.add(exclusion.channel);
    return true;
  });
}

/**
 * The inventory with every gone thread's key removed — a thread whose root no longer exists has no cursor
 * worth resuming from, and keeping it would only send the next sweep back to be told so again. Pure.
 *
 * @param checkpoints the inventory to retire keys from
 * @param gone every thread this sweep proved deleted
 * @returns a new inventory without those keys
 */
function retireGoneThreads({
  checkpoints,
  gone,
}: {
  checkpoints: RecoveryThreadCheckpoints;
  gone: readonly RecoveryGoneThread[];
}): RecoveryThreadCheckpoints {
  if (gone.length === 0) {
    return checkpoints;
  }
  const retired = new Set(gone.map((thread) => threadKey(thread)));
  return Object.fromEntries(Object.entries(checkpoints).filter(([key]) => !retired.has(key)));
}

/**
 * One entry per thread, first wins — the foreground and the background can each prove the same root gone.
 *
 * @param gone every gone thread both phases produced, in order
 * @returns the same list with repeats of a thread dropped
 */
function dedupeGoneThreads({ gone }: { gone: readonly RecoveryGoneThread[] }): readonly RecoveryGoneThread[] {
  const seen = new Set<string>();
  return gone.filter((thread) => {
    const key = threadKey(thread);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * The inventory after the foreground walk, and the background polls the planner allows over it. Registrations
 * sit BENEATH both, so a root the inventory already knows keeps its real cursor and its `lastCheckedAtIso`,
 * and one this sweep actually read keeps what the read earned — a registration only ever fills a key nothing
 * else has. A root the foreground just proved deleted is not planned, so the background never asks again.
 *
 * @param foreground the foreground walk's own aggregate
 * @param nowTs the sweep window's exclusive upper bound, as the planner's clock
 * @param threadCheckpoints the inventory the previous complete sweep persisted
 * @returns the merged inventory (gone roots still in it) and the planner's checks over it
 */
function planBackground({
  foreground,
  nowTs,
  threadCheckpoints,
}: {
  foreground: ForegroundScan;
  nowTs: string;
  threadCheckpoints: RecoveryThreadCheckpoints;
}): { readonly merged: RecoveryThreadCheckpoints; readonly plan: RecoveryThreadCheckPlan } {
  const merged = { ...foreground.rootRegistrations, ...threadCheckpoints, ...foreground.checkpointUpdates };
  const foregroundGone = new Set(foreground.goneThreads.map((thread) => threadKey(thread)));
  const plan = planRecoveryThreadChecks({
    checkpoints: retireGoneThreads({ checkpoints: merged, gone: foreground.goneThreads }),
    foregroundKeys: foreground.foregroundKeys,
    hints: foreground.hints.filter((hint) => !foregroundGone.has(threadKey(hint))),
    nowTs,
  });
  return { merged, plan };
}

/**
 * Scan every discovered channel over one recovery window, or fail per-channel without sinking the batch —
 * then, independently, poll a bounded, budgeted set of KNOWN threads whose roots may have already left the
 * history window, so a reply landing there is not lost merely because the visible walk above never saw it.
 *
 * @param api the Slack read seam (reused, never a fresh client)
 * @param channels every channel discovery returned — scan breadth, not reply permission
 * @param window the half-open Slack-history window to read
 * @param classification everything needed to cheap-pre-classify a candidate before its thread read —
 *   `allowedChannels` here is reply eligibility, never scan breadth; `channels` above is scan breadth
 * @param threadCheckpoints recovery's own known-thread inventory, before this sweep
 * @param onProgress optional per-channel progress callback
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known —
 *   threaded into every `candidateFromMessage` call so a peer bot's tag is recoverable like the live path
 * @returns every candidate found, which channels/threads failed and why, which threads are gone for good,
 *   whether the whole scan was complete, the updated thread-checkpoint inventory, and how the thread-read
 *   budget was spent
 */
export async function recoverWorkspace({
  api,
  channels,
  window,
  classification,
  threadCheckpoints,
  onProgress,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  channels: readonly SlackChannelRef[];
  window: RecoveryWindow;
  classification: ClassificationContext;
  threadCheckpoints: RecoveryThreadCheckpoints;
  onProgress?: RecoveryProgress;
  selfBotId: string | undefined;
}): Promise<RecoveryWorkspaceResult> {
  const foreground = await scanAllChannels({ api, channels, classification, onProgress, selfBotId, window });
  const { merged, plan } = planBackground({ foreground, nowTs: window.latestExclusiveTs, threadCheckpoints });
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const background = await runBackgroundChecks({ api, channelsById, checks: plan.checks, selfBotId, window });
  const candidates = [...foreground.candidates, ...background.candidates];
  const failures = [...foreground.failures, ...background.failures];
  const complete = failures.length === 0;
  const updated: RecoveryThreadCheckpoints = { ...merged, ...background.checkpointUpdates };
  const excludedChannels = dedupeExclusions({ exclusions: [...foreground.exclusions, ...background.exclusions] });
  // Retirement happens only on a COMPLETE sweep — the only one whose inventory is persisted anyway. A partial
  // sweep can reach one root twice with two different answers (a rate limit in the foreground, thread_not_found
  // from a hint in the background), and one rule here is what keeps every such mix from retiring a live thread.
  // An EXCLUDED channel retires nothing either: it keeps its checkpoints for a re-invite, and its exclusion
  // dropped whatever failures it had already scored this sweep, so "complete" says nothing about its threads.
  const excluded = new Set(excludedChannels.map((exclusion) => exclusion.channel));
  const retirable = [...foreground.goneThreads, ...background.goneThreads].filter(
    (thread) => !excluded.has(thread.channel),
  );
  const finalCheckpoints = complete ? retireGoneThreads({ checkpoints: updated, gone: retirable }) : updated;

  return {
    candidates,
    complete,
    completedChannels: foreground.completedChannels,
    discoveredChannels: channels.length,
    excludedChannels,
    failures,
    goneThreads: dedupeGoneThreads({ gone: [...foreground.goneThreads, ...background.goneThreads] }),
    threadCheckpoints: finalCheckpoints,
    threadCoverage: {
      backgroundReads: plan.checks.length,
      deferred: plan.deferred,
      foregroundReads: foreground.foregroundKeys.size,
      known: Object.keys(finalCheckpoints).length,
      skippedByLatestReply: plan.skippedByLatestReply,
    },
  };
}
