/**
 * The FOREGROUND half of one scheduled sweep — the history walk over every discovered channel. What one history
 * row is worth (cheaply excluded, or fully thread-read) is `recoverForegroundMessages.ts`. Why it is a module of
 * its own is the same reason `recoverBackground.ts` is: `recoverSweep.ts` composes the two phases and owns the
 * completeness accounting over both, while each phase owns its own reads. Both score a failed read through
 * `recoverShared.ts`, so the two can never disagree about one.
 *
 * A channel contributes candidates only when its ENTIRE history window and every candidate's thread read
 * completely — a channel this scan could only partially see must refuse to contribute, never silently report
 * "nothing unanswered" over the part it happened to read.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import type { SlackPageError } from "../slack/errors.js";
import { fetchCompleteSlackHistory } from "../slack/pagination.js";
import type { RecoveryCandidate } from "./recover.js";
import { type ClassificationContext, classifyChannelMessages } from "./recoverForegroundMessages.js";
import { candidateSurfaceFromChannel } from "./recoverScan.js";
import type { RecoveryWindow } from "./recoverSchedule.js";
import {
  permanentExclusion,
  type RecoveryChannelExclusion,
  type RecoveryCoverageFailure,
  type RecoveryGoneThread,
} from "./recoverShared.js";
import {
  type RecoveryThreadCheckpoint,
  type RecoveryThreadCheckpoints,
  type RecoveryThreadHint,
  recoveryRootRegistrations,
  recoveryThreadHints,
} from "./recoverThreads.js";

/** Per-channel progress, so a scan over hundreds of channels is never silent. */
export type RecoveryProgress = (progress: {
  readonly channelsCompleted: number;
  readonly channelsTotal: number;
  readonly candidatesFound: number;
}) => void;

/** One channel's foreground scan: candidates, failures, root hints, and any checkpoints its full reads earned. */
interface ChannelScan {
  readonly candidates: readonly RecoveryCandidate[];
  readonly failures: readonly RecoveryCoverageFailure[];
  readonly exclusions: readonly RecoveryChannelExclusion[];
  readonly goneThreads: readonly RecoveryGoneThread[];
  readonly hints: readonly RecoveryThreadHint[];
  readonly foregroundKeys: ReadonlySet<string>;
  readonly checkpointUpdates: RecoveryThreadCheckpoints;
  /** Every root this channel's history window showed, as a seed checkpoint — see `recoveryRootRegistrations`. */
  readonly rootRegistrations: RecoveryThreadCheckpoints;
}

/**
 * How a failed history read scores against coverage: a permanent one is an exclusion, anything else a
 * failure — see {@link permanentExclusion}.
 *
 * @param channel the channel id the read was for
 * @param error the typed pagination failure
 * @returns the exclusion or the failure to fold into that channel's scan
 */
function historyFailureScan({ channel, error }: { channel: string; error: SlackPageError }): {
  readonly exclusions?: readonly RecoveryChannelExclusion[];
  readonly failures?: readonly RecoveryCoverageFailure[];
} {
  const exclusion = permanentExclusion({ channel, error });
  if (exclusion !== undefined) {
    return { exclusions: [exclusion] };
  }
  return { failures: [{ channel, reason: error.message, stage: "history" }] };
}

/** A scan that found nothing — the base every early return of {@link scanOneChannel} spreads its own fields over. */
function emptyChannelScan(): ChannelScan {
  return {
    candidates: [],
    checkpointUpdates: {},
    exclusions: [],
    failures: [],
    foregroundKeys: new Set(),
    goneThreads: [],
    hints: [],
    rootRegistrations: {},
  };
}

async function scanOneChannel({
  api,
  channel,
  window,
  classification,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  channel: SlackChannelRef;
  window: RecoveryWindow;
  classification: ClassificationContext;
  selfBotId: string | undefined;
}): Promise<ChannelScan> {
  const empty = emptyChannelScan();
  const surface = candidateSurfaceFromChannel({ channel });
  if (surface.isErr()) {
    return { ...empty, failures: [{ channel: channel.id, reason: surface.error.join("; "), stage: "history" }] };
  }
  const history = await fetchCompleteSlackHistory({
    api,
    channel: channel.id,
    latest: window.latestExclusiveTs,
    oldest: window.oldestExclusiveTs,
  });
  if (history.isErr()) {
    return { ...empty, ...historyFailureScan({ channel: channel.id, error: history.error }) };
  }
  const classified = await classifyChannelMessages({
    api,
    channel,
    classification,
    rawMessages: history.value.rawMessages,
    selfBotId,
    surface: surface.value,
    window,
  });
  // A thread read that proved the channel unreadable excludes the WHOLE channel, hints included: a root hint
  // from here would only send the background phase to be told "not a member" again.
  if (classified.exclusion !== undefined) {
    return { ...empty, exclusions: [classified.exclusion] };
  }
  const hints = recoveryThreadHints({ channel: channel.id, rawMessages: history.value.rawMessages });
  // Every root this window showed is REGISTERED whether or not anything read it, so a reply arriving after
  // the root has scrolled out still has a checkpoint to be found through. Same rows, no extra Slack call.
  const rootRegistrations = recoveryRootRegistrations({ channel: channel.id, rawMessages: history.value.rawMessages });
  // ANY thread failure makes the whole channel's candidates AND checkpoints unusable — a partial thread
  // answer set could misclassify a candidate as unanswered when a reply the failed read never saw would
  // have excluded it, and a checkpoint built from an incomplete read is not safe to trust either. A root
  // REGISTRATION is a checkpoint, so it goes with them: the sweep is partial, nothing it produced will be
  // persisted anyway, and keeping one would only send the background phase back to the read that just
  // failed. The hints stay, exactly as they always have. A gone thread is a verdict about the inventory too,
  // so it goes with them: the same root can answer thread_not_found once and a rate limit the next time.
  if (classified.failures.length > 0) {
    return { ...empty, failures: classified.failures, hints };
  }
  return { ...classified, exclusions: [], failures: [], hints, rootRegistrations };
}

/** The foreground fast path's own aggregate, across every discovered channel. */
export interface ForegroundScan {
  readonly candidates: readonly RecoveryCandidate[];
  readonly failures: readonly RecoveryCoverageFailure[];
  readonly exclusions: readonly RecoveryChannelExclusion[];
  readonly goneThreads: readonly RecoveryGoneThread[];
  readonly hints: readonly RecoveryThreadHint[];
  readonly foregroundKeys: ReadonlySet<string>;
  readonly checkpointUpdates: RecoveryThreadCheckpoints;
  readonly rootRegistrations: RecoveryThreadCheckpoints;
  readonly completedChannels: number;
}

/**
 * Run the foreground fast path over every discovered channel, aggregating as it goes.
 *
 * @param api the Slack read seam
 * @param channels every channel discovery returned
 * @param classification everything needed to cheap-pre-classify a candidate before its thread read
 * @param window the half-open Slack-history window to read
 * @param onProgress optional per-channel progress callback
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the aggregated foreground scan
 */
export async function scanAllChannels({
  api,
  channels,
  classification,
  window,
  onProgress,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies">;
  channels: readonly SlackChannelRef[];
  classification: ClassificationContext;
  window: RecoveryWindow;
  onProgress?: RecoveryProgress | undefined;
  selfBotId: string | undefined;
}): Promise<ForegroundScan> {
  const candidates: RecoveryCandidate[] = [];
  const failures: RecoveryCoverageFailure[] = [];
  const exclusions: RecoveryChannelExclusion[] = [];
  const goneThreads: RecoveryGoneThread[] = [];
  const hints: RecoveryThreadHint[] = [];
  const foregroundKeys = new Set<string>();
  const checkpointUpdates: Record<string, RecoveryThreadCheckpoint> = {};
  const rootRegistrations: Record<string, RecoveryThreadCheckpoint> = {};
  let completedChannels = 0;
  let channelsCompleted = 0;
  for (const channel of channels) {
    const scanned = await scanOneChannel({ api, channel, classification, selfBotId, window });
    candidates.push(...scanned.candidates);
    failures.push(...scanned.failures);
    exclusions.push(...scanned.exclusions);
    goneThreads.push(...scanned.goneThreads);
    hints.push(...scanned.hints);
    Object.assign(rootRegistrations, scanned.rootRegistrations);
    for (const key of scanned.foregroundKeys) {
      foregroundKeys.add(key);
    }
    Object.assign(checkpointUpdates, scanned.checkpointUpdates);
    // An EXCLUDED channel is not a completed one either: it contributed nothing and was never read. Counting
    // it as complete would inflate the "N of M channels" line into a claim the sweep did not earn.
    if (scanned.failures.length === 0 && scanned.exclusions.length === 0) {
      completedChannels += 1;
    }
    channelsCompleted += 1;
    onProgress?.({ candidatesFound: candidates.length, channelsCompleted, channelsTotal: channels.length });
  }
  return {
    candidates,
    checkpointUpdates,
    completedChannels,
    exclusions,
    failures,
    foregroundKeys,
    goneThreads,
    hints,
    rootRegistrations,
  };
}
