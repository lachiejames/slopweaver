/**
 * `slopweaver listen` — the live loop: assembling the seams, arming supervision, driving the socket to
 * completion, and turning the result into a process exit code.
 *
 * Split out of {@link ./run.js} (the file-size ratchet, step 2). {@link startListening} is the entry point
 * `run.js`'s `runListen` calls once credentials are known good; everything else here is private wiring for
 * it. The live seams it assembles live in `./liveListenDeps.ts`, and the mention handler they wire in, with
 * the shared capture-time UX from `../../../live/listen/capture.ts` composed around it, in
 * `./capturingHandler.ts`.
 */

import { logger } from "../../../lib/logger.js";
import { type ListenScope, scopeLine } from "../../../live/listen/scope.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import type { ListenerBeatWriter } from "../../../live/listen/supervise/beatWriter.js";
import { THREAD_REPLY_DAILY_CAP } from "../../../live/listen/threadReply.js";
import { type ResponderWhitelist, whitelistSummary } from "../../../live/listen/whitelist.js";
import { detectSupervisorSession, type SupervisorSession } from "../../../supervisor/session.js";
import { EXIT_OK } from "../../exitCodes.js";
import type { ClockWake } from "./emit.js";
import { type ListenerOwnership, listenerOwnership, refuseUnownedListener } from "./listenerOwnership.js";
import { buildLiveListenDeps, progressLogFor } from "./liveListenDeps.js";
import { type ListenDeps, runListenLoop, WORK_ARM_GRACE_MS } from "./loop.js";
import { liveListenerBeatIfSupervised } from "./selfRecord.js";
import { guardStopSignals, nodeStopSignalProcess } from "./stopSignal.js";
import { type WitnessSetup, withWitnessTap } from "./witnessWiring.js";

/*
 * Everything between "the credentials are good" and the socket being open.
 *
 * ## A visible session owns answers; a durable capture may exist without one
 *
 * A one-shot listener must have a visible supervisor to receive what it emits. The explicitly durable
 * `--follow --queue` mode is different: AGENTS.md permits it to capture and acknowledge while no session is
 * present, because the queue is input a human later chooses to read and never a trigger. Every other
 * sessionless shape refuses before opening the socket.
 *
 * Replies are withheld from everyone not on the responder whitelist — the SAME list this listener already
 * gates admission against — `turn answer` applies that judgement unconditionally, there is no policy left
 * here to validate before it does.
 */
/** Narrate what this connection is about to do and how it is currently gated, before a byte crosses the wire. */
function announceListenerStart({
  ownership,
  progressLog,
  responderHatchOpen,
  responderWhitelist,
  scope,
  threadReplyChannels,
}: {
  ownership: Exclude<ListenerOwnership, { readonly kind: "refuse" }>;
  progressLog: ListenLog;
  responderHatchOpen: () => boolean;
  responderWhitelist: ResponderWhitelist;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): void {
  progressLog({
    line:
      "connecting to Slack over Socket Mode — capturing the next message that addresses the bot (an explicit " +
      "tag, in a channel or in a 1:1 DM). A refused tag gets a fixed reply, not silence; an admitted one is " +
      "printed, not answered. Ctrl-C to stop.",
  });
  progressLog({
    line: `scope: ${scopeLine({ scope })}${scope.kind === "all" ? "" : " — a tag anywhere else is dropped with no reply and no reaction"}`,
  });
  // The address set is wider than the line above whenever this is on, and the ONLY other place that fact
  // exists is this process's argv — so a reader who never sees this line cannot tell the feature is live.
  if (threadReplyChannels.length > 0) {
    progressLog({
      line:
        `thread replies: a reply under one of the bot's OWN posts is ALSO an address in ${threadReplyChannels.join(", ")} ` +
        "— the thread root must be this bot's own message, nothing top-level wakes it, and one thread wakes at " +
        `most ${String(THREAD_REPLY_DAILY_CAP)} replies a day`,
    });
  }
  // Printed at START, before a byte crosses the wire, for the same reason the withhold line below is: a gate
  // you find out about by watching tags go unanswered is a gate that reads as a broken bot.
  progressLog({ line: whitelistSummary({ openOverride: responderHatchOpen(), whitelist: responderWhitelist }) });
  progressLog({
    line:
      ownership.kind === "capture-only"
        ? `capture-only — ${ownership.reason} Addresses will be acknowledged and queued; no answer runs until a visible session reads the queue.`
        : "replies are withheld from everyone not on the responder whitelist (applied by `turn answer`)",
  });
}

async function driveLiveLoop({
  allowMultipleConnections,
  appToken,
  botToken,
  deadlineMs,
  emit,
  follow,
  heartbeatArmId,
  home,
  json,
  once,
  progressLog,
  queuePath,
  responderHatchOpen,
  scope,
  supervisor,
  threadReplyChannels,
  witness,
}: {
  allowMultipleConnections: boolean;
  appToken: string;
  botToken: string;
  deadlineMs: number | undefined;
  emit: boolean;
  follow: boolean;
  heartbeatArmId: string | undefined;
  home: string;
  json: boolean;
  once: boolean;
  progressLog: ListenLog;
  queuePath: string | undefined;
  responderHatchOpen: () => boolean;
  scope: ListenScope;
  supervisor: SupervisorSession | undefined;
  threadReplyChannels: readonly string[];
  witness: WitnessSetup | undefined;
}): Promise<number> {
  const beat = liveListenerBeatIfSupervised({ armId: heartbeatArmId, home, progressLog, scope, threadReplyChannels });
  const addressDeps = await buildLiveListenDeps({
    allowMultipleConnections,
    beat,
    botToken,
    deadlineMode: deadlineMs !== undefined,
    emit,
    follow,
    heartbeatArmId,
    home,
    json,
    progressLog,
    queuePath,
    responderHatchOpen,
    scope,
    supervisor,
    threadReplyChannels,
  });
  const deps = withWitnessTap({ deps: addressDeps, follow, progressLog, queuePath, witness });
  return exitCodeOfLoop({ appToken, beat, deadlineMs, deps, once, progressLog });
}

/**
 * Drive the loop to completion and turn its result into a process exit code, stopping the heartbeat on the
 * way out however it ends.
 *
 * The `finally` is the point: a listener that exits — cleanly, on a signal, or by throwing — must write its
 * final `disconnected` beat, or the supervisor reads a stale `connected` beat from a process that is gone
 * and calls it healthy for a whole staleness window.
 *
 * @param appToken the Socket Mode app token
 * @param beat the heartbeat writer, or `undefined` when this listener is not supervised
 * @param deadlineMs the epoch-ms instant racing the socket, or `undefined` for no race
 * @param deps the assembled live seams
 * @param once whether to stop after one mention
 * @param progressLog where a trapped signal narrates what it is doing
 * @returns the process exit code
 */
async function exitCodeOfLoop({
  appToken,
  beat,
  deadlineMs,
  deps,
  once,
  progressLog,
}: {
  appToken: string;
  beat: ListenerBeatWriter | undefined;
  deadlineMs: number | undefined;
  deps: ListenDeps;
  once: boolean;
  progressLog: ListenLog;
}): Promise<number> {
  const stop = guardStopSignals({
    forceExitAfterMs: WORK_ARM_GRACE_MS,
    log: progressLog,
    schedule: ({ ms, tick }) => {
      const timer = setTimeout(tick, ms);
      timer.unref();
      return () => {
        clearTimeout(timer);
      };
    },
    target: nodeStopSignalProcess(),
  });
  let result: Awaited<ReturnType<typeof runListenLoop>>;
  try {
    result = await runListenLoop({
      appToken,
      deps,
      once,
      stopSignal: stop.signal,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
    });
  } finally {
    stop.release();
    beat?.stop();
  }
  // A trapped signal outranks whatever the loop itself reported: the process was ASKED to stop, and a
  // listener that swallowed Ctrl-C and exited 0 would be the defect `tabGuard.ts` names. Read after the
  // loop returns, because only this edge knows a signal is why it did.
  const stopped = stop.firedCode();
  if (stopped !== undefined) {
    return stopped;
  }
  if (result.kind === "exit") {
    return result.code;
  }
  const clockWake: ClockWake = { deadlineMs: result.deadlineMs, kind: "clock-wake" };
  logger.out({ line: JSON.stringify(clockWake) });
  return EXIT_OK;
}

/**
 * Everything between "the credentials are good" and the socket being open.
 *
 * See {@link announceListenerStart}'s own header for what a visible session's ownership means here, and
 * `../../../live/listen/whitelist.js` for the responder gate applied on the way in.
 *
 * @param allowMultipleConnections the resolved SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS break-glass
 * @param appToken the Socket Mode app token
 * @param botToken the bot token this listener posts and reacts with
 * @param deadlineMs the epoch-ms instant racing the socket, or `undefined` for no race
 * @param heartbeatArmId the arm id to beat under, or `undefined` when this listener is not supervised
 * @param home the state home every seam reads its config from
 * @param emit whether the mention is emitted as JSON
 * @param follow whether the listener stays connected across mentions
 * @param json whether output is machine-readable
 * @param once whether to stop after one mention
 * @param queuePath the durability file a captured mention is appended to, when one was asked for
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist the startup snapshot of who may command the bot, narrated once — admission itself re-reads
 *   `responders.json` per addressed mention, so a `responders add` needs no restart
 * @param scope the conversations this listener acts on; a tag outside them gets no Slack effect at all
 * @param threadReplyChannels the conversations a reply under one of the bot’s own posts counts as an address
 *   in; empty is the default and leaves every channel answering tags only
 * @param witness the peer bots whose tagged threads are witnessed and their thread snapshot, resolved at
 *   start (`./witnessWiring.ts`); `undefined` leaves witnessing inert
 * @returns the process exit code
 */
export async function startListening({
  deadlineMs,
  follow,
  queuePath,
  responderHatchOpen,
  responderWhitelist,
  scope,
  threadReplyChannels,
  ...loop
}: {
  allowMultipleConnections: boolean;
  appToken: string;
  botToken: string;
  deadlineMs: number | undefined;
  heartbeatArmId: string | undefined;
  home: string;
  emit: boolean;
  follow: boolean;
  json: boolean;
  once: boolean;
  queuePath: string | undefined;
  responderHatchOpen: () => boolean;
  responderWhitelist: ResponderWhitelist;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
  witness: WitnessSetup | undefined;
}): Promise<number> {
  const progressLog = progressLogFor({ deadlineMode: deadlineMs !== undefined, follow });
  const detection = detectSupervisorSession({ env: process.env });
  const ownership = listenerOwnership({ detection, follow, queuePath });
  if (ownership.kind === "refuse") {
    return refuseUnownedListener({ reason: ownership.reason });
  }
  announceListenerStart({ ownership, progressLog, responderHatchOpen, responderWhitelist, scope, threadReplyChannels });
  // Every option but the whitelist's startup snapshot is the loop's too; admission re-reads the file itself.
  return driveLiveLoop({
    ...loop,
    deadlineMs,
    follow,
    progressLog,
    queuePath,
    responderHatchOpen,
    scope,
    supervisor: ownership.kind === "supervised" ? ownership.session : undefined,
    threadReplyChannels,
  });
}
