/**
 * One scheduled sweep's CLASSIFY stage: build the classification context from the ignore stores and the ask
 * lifecycle, scan the window (`./scheduledScan.ts`), and classify every candidate the scan found. Split out of
 * `./scheduledRecover.ts`, whose own header carries why a partial scan captures nothing; this module only ever
 * classifies, and capture stays with the sweep.
 */
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { foldAskLifecycle, parseAskLifecycleLog, terminalAskEventsByKey } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { type RecoveryReport, recoveryReport } from "../../../live/listen/recover.js";
import type { ClassificationContext } from "../../../live/listen/recoverForegroundMessages.js";
import type { RecoveryWindow } from "../../../live/listen/recoverSchedule.js";
import type { RecoveryThreadCheckpoints } from "../../../live/listen/recoverThreads.js";
import { chromeFromProfile } from "../slack/wiring.js";
import { type ScheduledIncidentDetect, scanWorkspace, type WorkspaceScan } from "./scheduledScan.js";

/**
 * Scan the window, then classify every candidate it found against the reply-eligible channels.
 *
 * @param api the Slack read seam
 * @param botUserId the bot's own Slack USER id
 * @param channels the channels the bot may answer in — reply eligibility, never scan breadth
 * @param home the Slopweaver home
 * @param incidents the live-incident seam, handed every discovered channel
 * @param nowMs the sweep's instant, epoch milliseconds
 * @param threadCheckpoints recovery's own known-thread inventory, before this sweep
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the classified report, the underlying workspace scan, and the context both it and the stranded
 *   lane classify against
 */
export async function classifyWorkspace({
  api,
  botUserId,
  channels,
  home,
  incidents,
  nowMs,
  threadCheckpoints,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "history" | "replies" | "listChannels">;
  botUserId: string;
  channels: readonly string[];
  home: string;
  incidents: ScheduledIncidentDetect;
  nowMs: number;
  threadCheckpoints: RecoveryThreadCheckpoints;
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<{
  readonly classification: ClassificationContext;
  readonly report: RecoveryReport;
  readonly scan: WorkspaceScan;
}> {
  const ignored = currentlyIgnoredAsks({ home });
  const ignoredConversations = currentlyIgnoredConversations({ home });
  const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
  const lifecycles = foldAskLifecycle({ events });
  const terminalByAsk = terminalAskEventsByKey({ events });
  const classification: ClassificationContext = {
    allowedChannels: channels,
    botUserId,
    cardEventType: chromeFromProfile({ home }).metadataEventType,
    ignored,
    ignoredConversations,
    lifecycles,
    since: window.sinceIso,
    terminalByAsk,
  };
  const scan = await scanWorkspace({ api, classification, incidents, nowMs, selfBotId, threadCheckpoints, window });
  // Spread rather than restated: `ClassificationContext` IS the bag `recoveryReport` classifies with, and a
  // ninth field listed in one place and forgotten in the other is how a whole exclusion goes silent.
  const report = recoveryReport({ ...classification, candidates: scan.candidates });
  return { classification, report, scan };
}
