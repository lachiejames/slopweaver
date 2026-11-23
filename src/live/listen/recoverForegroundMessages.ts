/**
 * The per-MESSAGE half of the foreground walk — one channel's history rows, each either cheaply excluded or
 * fully thread-read, folded into that channel's candidates, failures, gone threads and earned checkpoints.
 * `recoverForeground.ts` owns the per-CHANNEL walk around it (the history read, the empty and failed scans,
 * the root hints); this module owns what one row is worth. A failed thread read is scored through
 * `recoverShared.ts`, the same verdicts the background polls use, so the phases never disagree about one.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import { threadKey } from "../../corpus/slack/threadCursors.js";
import type { IgnoredAsk } from "../ask/ignore.js";
import type { IgnoredConversation } from "../ask/ignoredConversation.js";
import type { AskLifecycle, TerminalAskLifecycleEvent } from "../ask/lifecycle.js";
import type { SlackPageError } from "../slack/errors.js";
import { fetchCompleteSlackThread } from "../slack/pagination.js";
import {
  type CandidateSurface,
  candidateFromMessage,
  classifyCandidate,
  type RecoveryCandidate,
  threadEvidence,
  UNREAD_THREAD,
} from "./recover.js";
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
import { type RecoveryThreadCheckpoint, type RecoveryThreadCheckpoints, recoveryReplyRows } from "./recoverThreads.js";

/**
 * One shallow candidate's outcome: skip, a batch of candidates (root + any replies), a thread failure, a
 * whole-channel exclusion, or a thread whose root was deleted between the history read and the thread read.
 */
type MessageOutcome =
  | { readonly kind: "skip" }
  | { readonly kind: "thread-gone"; readonly gone: RecoveryGoneThread }
  | {
      readonly kind: "candidates";
      readonly candidates: readonly RecoveryCandidate[];
      readonly checkpoint?: { readonly key: string; readonly value: RecoveryThreadCheckpoint };
    }
  | { readonly kind: "thread-failure"; readonly failure: RecoveryCoverageFailure }
  | { readonly kind: "channel-excluded"; readonly exclusion: RecoveryChannelExclusion };

/** Everything needed to cheap-pre-classify a shallow candidate before paying for its thread read. */
export interface ClassificationContext {
  readonly allowedChannels: readonly string[];
  readonly botUserId: string;
  /** The operator's `slackBot.cardChrome.metadataEventType` — see `./recover.ts#answeredInThread`. */
  readonly cardEventType: string;
  readonly ignored: ReadonlyMap<string, IgnoredAsk>;
  readonly ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  readonly lifecycles: ReadonlyMap<string, AskLifecycle>;
  readonly since: string;
  readonly terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent>;
}

/**
 * How a failed foreground thread read scores: a permanent channel answer excludes the whole channel, a deleted
 * root retires that one thread, anything else is a thread-stage coverage failure — see
 * {@link permanentExclusion} and {@link goneThread}. Pure.
 *
 * @param channel the channel the thread is in
 * @param error the typed pagination failure
 * @param messageTs the candidate whose thread was being read
 * @param threadTs the root of the thread that read was for
 * @returns the outcome to fold into the channel's scan
 */
function failedThreadOutcome({
  channel,
  error,
  messageTs,
  threadTs,
}: {
  channel: string;
  error: SlackPageError;
  messageTs: string;
  threadTs: string;
}): MessageOutcome {
  const exclusion = permanentExclusion({ channel, error });
  if (exclusion !== undefined) {
    return { exclusion, kind: "channel-excluded" };
  }
  const gone = goneThread({ channel, error, threadTs });
  if (gone !== undefined) {
    return { gone, kind: "thread-gone" };
  }
  return { failure: { channel, messageTs, reason: error.message, stage: "thread" }, kind: "thread-failure" };
}

/**
 * Classify one raw history message: not a candidate, cheaply excluded, or fully thread-read — and, when a
 * full read did happen, every reply row it carries becomes a candidate too (the fix), and the thread earns a
 * fresh checkpoint so a LATER sweep can find it again after its root leaves the history window.
 *
 * @param api the Slack read seam
 * @param channel the discovered channel this message came from
 * @param message the raw history row
 * @param surface this channel's own surface
 * @param classification everything needed to cheap-pre-classify a candidate before its thread read
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the outcome — skip, candidates, or a thread-read failure
 */
async function outcomeForMessage({
  api,
  channel,
  message,
  surface,
  classification,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "replies">;
  channel: SlackChannelRef;
  message: unknown;
  surface: CandidateSurface;
  classification: ClassificationContext;
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<MessageOutcome> {
  const shallow = candidateFromMessage({ channel: channel.id, evidence: UNREAD_THREAD, message, selfBotId, surface });
  if (shallow === undefined) {
    return { kind: "skip" };
  }
  // Every exclusion `classifyCandidate` can reach WITHOUT thread content — not-addressed, wrong-place,
  // too-old, deliberately-ignored, terminal-lifecycle — already holds true or false regardless of what the
  // thread turns out to contain, so checking with empty `threadAnswers`/`threadMarks` first and skipping the
  // read entirely when something already excludes it is exact, not an approximation. `already-answered` and
  // `answered-in-thread` are the two that need the thread and are deliberately NOT in that list: both can
  // only ever ADD an exclusion, so a candidate this pass already excluded cannot become recoverable for want
  // of them, and the one it does not exclude goes on to the full read below. Measured against the real workspace
  // this bot runs in: of ~2,750 shallow candidates in a 3-day window, this cut the thread-read count by over
  // 98% — the budget the background phase below is deliberately sized to respect, not regress.
  const cheap = classifyCandidate({ candidate: shallow, ...classification });
  if (cheap.exclusions.length > 0) {
    return { candidates: [shallow], kind: "candidates" };
  }
  const thread = await fetchCompleteSlackThread({
    api,
    channel: channel.id,
    includeAllMetadata: true,
    threadTs: shallow.threadTs,
  });
  if (thread.isErr()) {
    const { messageTs, threadTs } = shallow;
    return failedThreadOutcome({ channel: channel.id, error: thread.error, messageTs, threadTs });
  }
  const evidence = threadEvidence({ rawMessages: thread.value.rawMessages, selfBotId });
  const replyRows = recoveryReplyRows({
    afterTs: "0",
    beforeTs: window.latestExclusiveTs,
    rawMessages: thread.value.rawMessages,
    threadTs: shallow.threadTs,
  });
  const replyCandidates = repliesToCandidates({ channel: channel.id, evidence, replyRows, selfBotId, surface });
  const checkpoint = checkpointAfterRead({ checkedAtIso: window.untilIso, currentCursorTs: "0", rows: replyRows });
  return {
    candidates: [{ ...shallow, threadAnswers: evidence.answers, threadMarks: evidence.marks }, ...replyCandidates],
    checkpoint: { key: threadKey({ channel: channel.id, threadTs: shallow.threadTs }), value: checkpoint },
    kind: "candidates",
  };
}

/** The per-message foreground classification loop's own aggregate, over one channel's history rows. */
interface MessageClassification {
  readonly candidates: readonly RecoveryCandidate[];
  readonly failures: readonly RecoveryCoverageFailure[];
  readonly goneThreads: readonly RecoveryGoneThread[];
  readonly foregroundKeys: ReadonlySet<string>;
  readonly checkpointUpdates: RecoveryThreadCheckpoints;
  /** Set when a thread read proved the whole channel permanently unreadable — the loop stops there. */
  readonly exclusion?: RecoveryChannelExclusion;
}

/**
 * Classify every raw history row in one channel, aggregating the foreground fast path's own output.
 *
 * @param api the Slack read seam
 * @param channel the discovered channel these rows came from
 * @param classification everything needed to cheap-pre-classify a candidate before its thread read
 * @param rawMessages the channel's history rows for this window
 * @param surface this channel's own surface
 * @param window the sweep's own window
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the aggregated classification
 */
export async function classifyChannelMessages({
  api,
  channel,
  classification,
  rawMessages,
  surface,
  window,
  selfBotId,
}: {
  api: Pick<SlackApi, "replies">;
  channel: SlackChannelRef;
  classification: ClassificationContext;
  rawMessages: readonly unknown[];
  surface: CandidateSurface;
  window: RecoveryWindow;
  selfBotId: string | undefined;
}): Promise<MessageClassification> {
  const candidates: RecoveryCandidate[] = [];
  const failures: RecoveryCoverageFailure[] = [];
  const goneThreads: RecoveryGoneThread[] = [];
  const foregroundKeys = new Set<string>();
  const checkpointUpdates: Record<string, RecoveryThreadCheckpoint> = {};
  for (const message of rawMessages) {
    const outcome = await outcomeForMessage({ api, channel, classification, message, selfBotId, surface, window });
    if (outcome.kind === "candidates") {
      candidates.push(...outcome.candidates);
      if (outcome.checkpoint !== undefined) {
        foregroundKeys.add(outcome.checkpoint.key);
        checkpointUpdates[outcome.checkpoint.key] = outcome.checkpoint.value;
      }
    } else if (outcome.kind === "thread-failure") {
      failures.push(outcome.failure);
    } else if (outcome.kind === "thread-gone") {
      // The message was deleted after the history read listed it: there is nothing left to answer, and the
      // rest of the channel read fine, so this costs the channel nothing.
      goneThreads.push(outcome.gone);
    } else if (outcome.kind === "channel-excluded") {
      // One thread read answering "not a member" is a fact about the CHANNEL, not that thread: every further
      // read here would answer the same way, so paying for them is waste and reporting them is noise.
      return {
        candidates: [],
        checkpointUpdates: {},
        exclusion: outcome.exclusion,
        failures: [],
        foregroundKeys: new Set(),
        goneThreads: [],
      };
    }
  }
  return { candidates, checkpointUpdates, failures, foregroundKeys, goneThreads };
}
