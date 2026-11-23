/**
 * The BACKGROUND half of one scheduled sweep — polling threads recovery's own inventory remembers, whose
 * roots have already scrolled out of the history window the foreground walk reads.
 *
 * Why it is a phase rather than more of `recoverSweep.ts`: `conversations.history` can only ever show a
 * root while it is inside the window, so a reply arriving a day later is reachable through the checkpoint
 * inventory or not at all. `recoverThreadPlan.ts` decides WHICH remembered threads this sweep may poll and
 * how many; this module performs those polls and scores what comes back, using the same verdicts the
 * foreground uses (`recoverShared.ts`) so the two can never disagree about a failed read.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import { threadKey } from "../../corpus/slack/threadCursors.js";
import { fetchCompleteSlackThreadSince } from "../slack/pagination.js";
import { type CandidateSurface, type RecoveryCandidate, threadEvidence } from "./recover.js";
import { candidateSurfaceFromChannel } from "./recoverScan.js";
import type { RecoveryWindow } from "./recoverSchedule.js";
import {
  checkpointAfterRead,
  goneThread,
  permanentExclusion,
  type RecoveryChannelExclusion,
  type RecoveryCoverageFailure,
  type RecoveryGoneThread,
  repliesToCandidates,
} from "./recoverShared.js";
import type { RecoveryThreadCheck } from "./recoverThreadPlan.js";
import { type RecoveryThreadCheckpoint, type RecoveryThreadCheckpoints, recoveryReplyRows } from "./recoverThreads.js";

/**
 * One background-poll outcome: the reply candidates it found, or the failure that made it untrustworthy.
 *
 * @param api the Slack read seam
 * @param channel the channel this thread belongs to
 * @param oldest the cursor to read replies since
 * @param surface this channel's own surface
 * @param threadTs the thread to poll
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the candidates found, any failure, exclusion or gone thread, and the checkpoint to store
 */
async function runBackgroundCheck({
  api,
  channel,
  oldest,
  surface,
  threadTs,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "replies">;
  channel: string;
  oldest: string;
  surface: CandidateSurface;
  threadTs: string;
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<{
  readonly candidates: readonly RecoveryCandidate[];
  readonly failure?: RecoveryCoverageFailure;
  readonly exclusion?: RecoveryChannelExclusion;
  readonly gone?: RecoveryGoneThread;
  readonly checkpoint?: RecoveryThreadCheckpoint;
}> {
  const thread = await fetchCompleteSlackThreadSince({ api, channel, includeAllMetadata: true, oldest, threadTs });
  if (thread.isErr()) {
    // This is the read that pinned the watermark: a remembered checkpoint in a channel the
    // bot had since been removed from. The checkpoint is deliberately KEPT — if the bot is invited back, the
    // cursor is still the right place to resume from — and the channel is reported excluded instead.
    const exclusion = permanentExclusion({ channel, error: thread.error });
    if (exclusion !== undefined) {
      return { candidates: [], exclusion };
    }
    // A deleted root answers the same way on every future poll, so it is reported and its checkpoint retired
    // by the caller, rather than failing every sweep the rotation reaches it on.
    const gone = goneThread({ channel, error: thread.error, threadTs });
    if (gone !== undefined) {
      return { candidates: [], gone };
    }
    return { candidates: [], failure: { channel, messageTs: threadTs, reason: thread.error.message, stage: "thread" } };
  }
  const evidence = threadEvidence({ rawMessages: thread.value.rawMessages, selfBotId });
  const replyRows = recoveryReplyRows({
    afterTs: oldest,
    beforeTs: window.latestExclusiveTs,
    rawMessages: thread.value.rawMessages,
    threadTs,
  });
  return {
    candidates: repliesToCandidates({ channel, evidence, replyRows, selfBotId, surface }),
    checkpoint: checkpointAfterRead({ checkedAtIso: window.untilIso, currentCursorTs: oldest, rows: replyRows }),
  };
}

/** The surface to classify a background check's candidates under — real metadata when the channel is still discovered. */
function surfaceForBackgroundChannel({
  channel,
  channelsById,
}: {
  channel: string;
  channelsById: ReadonlyMap<string, SlackChannelRef>;
}): CandidateSurface {
  const ref = channelsById.get(channel);
  if (ref === undefined) {
    return "channel";
  }
  const surface = candidateSurfaceFromChannel({ channel: ref });
  return surface.isOk() ? surface.value : "channel";
}

/**
 * Run every background check the planner selected, in order, accumulating candidates/failures/checkpoints.
 *
 * @param api the Slack read seam
 * @param channelsById every discovered channel, by id, for surface classification
 * @param checks the planner's selected background checks, already cut to budget
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns every reply candidate found, every failure hit, every channel proved unreadable, every thread
 *   whose root is gone, and the checkpoint updates earned
 */
export async function runBackgroundChecks({
  api,
  channelsById,
  checks,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "replies">;
  channelsById: ReadonlyMap<string, SlackChannelRef>;
  checks: readonly RecoveryThreadCheck[];
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<{
  readonly candidates: readonly RecoveryCandidate[];
  readonly failures: readonly RecoveryCoverageFailure[];
  readonly exclusions: readonly RecoveryChannelExclusion[];
  readonly goneThreads: readonly RecoveryGoneThread[];
  readonly checkpointUpdates: RecoveryThreadCheckpoints;
}> {
  const candidates: RecoveryCandidate[] = [];
  const failures: RecoveryCoverageFailure[] = [];
  const exclusions: RecoveryChannelExclusion[] = [];
  const goneThreads: RecoveryGoneThread[] = [];
  const checkpointUpdates: Record<string, RecoveryThreadCheckpoint> = {};
  for (const check of checks) {
    const surface = surfaceForBackgroundChannel({ channel: check.channel, channelsById });
    const result = await runBackgroundCheck({ ...check, api, selfBotId, surface, window });
    candidates.push(...result.candidates);
    if (result.failure !== undefined) {
      failures.push(result.failure);
    }
    if (result.exclusion !== undefined) {
      exclusions.push(result.exclusion);
    }
    if (result.gone !== undefined) {
      goneThreads.push(result.gone);
    }
    if (result.checkpoint !== undefined) {
      checkpointUpdates[threadKey({ channel: check.channel, threadTs: check.threadTs })] = result.checkpoint;
    }
  }
  return { candidates, checkpointUpdates, exclusions, failures, goneThreads };
}
