/**
 * One scheduled sweep's workspace SCAN: discovery, then live-incident detection over the whole discovery, then the
 * recovery read of the actionable channels — the stage `scheduledRecover.ts` classifies and captures from.
 *
 * Detection sits here, between discovery and the first channel read, so nothing the recovery lane does can keep a
 * discovered incident channel off the board: it sees every channel discovery returned, joined or not (an incident
 * channel is one the bot has usually NOT joined yet), and a throw inside it is a reported refusal rather than the end
 * of the sweep.
 */
import type { SlackApi, SlackChannelRef } from "../../../corpus/slack/fetch.js";
import type { IncidentDetectReport } from "../../../incident/detect.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import type { ClassificationContext } from "../../../live/listen/recoverForegroundMessages.js";
import type { RecoveryWindow } from "../../../live/listen/recoverSchedule.js";
import {
  actionableChannels,
  type RecoveryWorkspaceResult,
  recoverWorkspace,
} from "../../../live/listen/recoverSweep.js";
import type { RecoveryThreadCoverage } from "../../../live/listen/recoverThreadPlan.js";
import type { RecoveryThreadCheckpoints } from "../../../live/listen/recoverThreads.js";
import { fetchCompleteSlackChannels } from "../../../live/slack/channelPagination.js";

/** What one workspace scan produced, before classification — plus what live-incident detection made of discovery. */
export type WorkspaceScan = Omit<RecoveryWorkspaceResult, "completedChannels" | "discoveredChannels"> & {
  readonly incidents: IncidentDetectReport;
};

/** The live-incident seam: judge one sweep's discovered channels, register each new live incident as a board row. */
export type ScheduledIncidentDetect = (args: {
  channels: readonly SlackChannelRef[];
  nowMs: number;
}) => Promise<IncidentDetectReport>;

const EMPTY_THREAD_COVERAGE: RecoveryThreadCoverage = {
  backgroundReads: 0,
  deferred: 0,
  foregroundReads: 0,
  known: 0,
  skippedByLatestReply: 0,
};

/**
 * Run live-incident detection over one discovery, so that a throw inside it is a reported refusal rather than the
 * end of the recovery sweep — and the recovery effects after it cannot reach it at all, because it runs first.
 *
 * @param incidents the live-incident seam
 * @param channels every channel discovery returned
 * @param nowMs the sweep's instant, epoch milliseconds
 * @returns what detection did, or the refusal naming what threw
 */
async function isolatedIncidentDetect({
  incidents,
  channels,
  nowMs,
}: {
  incidents: ScheduledIncidentDetect;
  channels: readonly SlackChannelRef[];
  nowMs: number;
}): Promise<IncidentDetectReport> {
  try {
    return await incidents({ channels, nowMs });
  } catch (error: unknown) {
    return { refused: `incident detection threw: ${errorMessage({ error })}`, registered: [], skipped: [] };
  }
}

/**
 * Discover every visible conversation over the window, or fall back to a whole-scan discovery failure. Live-incident
 * detection runs on the discovery FIRST, before `actionableChannels` narrows it and before any recovery effect.
 *
 * @param api the Slack read seam
 * @param classification everything needed to cheap-pre-classify a candidate before its thread read
 * @param incidents the live-incident seam, handed every discovered channel
 * @param nowMs the sweep's instant, epoch milliseconds
 * @param threadCheckpoints recovery's own known-thread inventory, before this sweep
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the workspace scan result
 */
export async function scanWorkspace({
  api,
  classification,
  incidents,
  nowMs,
  threadCheckpoints,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies" | "listChannels">;
  classification: ClassificationContext;
  incidents: ScheduledIncidentDetect;
  nowMs: number;
  threadCheckpoints: RecoveryThreadCheckpoints;
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<WorkspaceScan> {
  const discovery = await fetchCompleteSlackChannels({ api });
  if (discovery.isErr()) {
    return {
      candidates: [],
      complete: false,
      excludedChannels: [],
      failures: [{ reason: discovery.error.message, stage: "discovery" }],
      goneThreads: [],
      incidents: { refused: `discovery failed: ${discovery.error.message}`, registered: [], skipped: [] },
      threadCheckpoints,
      threadCoverage: EMPTY_THREAD_COVERAGE,
    };
  }
  const incidentReport = await isolatedIncidentDetect({ channels: discovery.value.channels, incidents, nowMs });
  const scanned = await recoverWorkspace({
    api,
    channels: actionableChannels({ channels: discovery.value.channels }),
    classification,
    selfBotId,
    threadCheckpoints,
    window,
  });
  return { ...scanned, incidents: incidentReport };
}
