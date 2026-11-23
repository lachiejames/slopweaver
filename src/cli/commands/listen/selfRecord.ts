/**
 * What a LIVE listener records about itself, from inside its own process: its arm, its heartbeat, and the
 * connection count Slack reported to it.
 *
 * Split out of {@link ./runLoop.js} when that file passed the size ratchet, along one real seam — every
 * function here is a production writer into `$home/live/listener/`, each narrating and SWALLOWING its own
 * write failure. That shared rule is the reason they belong together: this state exists so a supervisor, or
 * the next `listen arm`, can read it, and a listener that crashed protecting a hint would take a live socket
 * down with it.
 */

import { publishSupervisorEvent } from "../../../events/store.js";
import type { ListenScope } from "../../../live/listen/scope.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import { type ListenerBeatWriter, startListenerBeat } from "../../../live/listen/supervise/beatWriter.js";
import {
  appendListenerArmEvent,
  clearListenerArm,
  listenerLogPath,
  writeListenerArm,
  writeListenerHeartbeat,
  writeSocketConnectionObservation,
} from "../../../live/listen/supervise/store.js";
import { listenerArmedEvent } from "../../../live/listen/supervise/streamEvents.js";

/**
 * The production recorder for the `hello` frame's connection count: one whole-file write under the home,
 * stamped with the instant it was observed.
 *
 * A failed write is NARRATED and swallowed, exactly like a failed beat — this record informs the NEXT
 * `listen arm`, and a listener that crashed over it would take down a live socket to protect a hint.
 *
 * @param armId the arm this listener was started as, or `undefined` for a hand-typed unsupervised one
 * @param clockIso sampled inside each hello callback for the observation instant; the wall clock unless a
 *   test passes a fixed one
 * @param home the Slopweaver home the record lives under
 * @param progressLog where a failed write is narrated
 * @returns the callback `ListenDeps.onHello` is wired to
 */
export function liveHelloRecorder({
  armId,
  clockIso = () => new Date().toISOString(),
  home,
  progressLog,
}: {
  armId: string | undefined;
  clockIso?: () => string;
  home: string;
  progressLog: ListenLog;
}): (args: { connections: number }) => void {
  return ({ connections }) => {
    const written = writeSocketConnectionObservation({
      home,
      observation: {
        connections,
        observedAtIso: clockIso(),
        pid: process.pid,
        ...(armId === undefined ? {} : { armId }),
      },
    });
    if (written.isErr()) {
      progressLog({ line: `could not record the Socket Mode connection count — continuing: ${written.error.message}` });
    }
  };
}

/**
 * Record THIS process as the current arm, from inside it.
 *
 * The registration has to happen here rather than in whatever started the command, and the reason is
 * measured: the bundled launcher `exec`s `tsx`, and `tsx` then FORKS the process that opens the socket, so a
 * pid captured by the caller is the launcher's rather than the listener's. A supervisor watching that pid
 * would see a live launcher over a dead listener, or — worse — signal the launcher, leave the real listener
 * holding the socket, and hand back a re-arm that produced a SECOND Socket Mode connection. `process.pid`
 * here is the process that actually beats and actually holds the socket.
 *
 * A failed write is NARRATED and swallowed, for the same reason a failed beat is: an unwatchable listener
 * still answers tags, and crashing the bot over a supervision file would trade a real capability for a
 * diagnostic one.
 *
 * @param armId the arm id this listener was started as
 * @param home the Slopweaver home the record lives under
 * @param progressLog where a failed write is narrated
 * @param scope the conversations this listener acts on, recorded so a re-arm after its death keeps them
 * @param threadReplyChannels the conversations a reply under the bot's own post is an address in, recorded
 *   for the same reason the scope is — a re-arm that dropped them would switch the feature off silently
 */
function registerThisArm({
  armId,
  home,
  progressLog,
  scope,
  threadReplyChannels,
}: {
  armId: string;
  home: string;
  progressLog: ListenLog;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): void {
  const startedAtIso = new Date().toISOString();
  const arm = {
    armId,
    logPath: listenerLogPath({ armId, home }),
    pid: process.pid,
    scope,
    startedAtIso,
    threadReplyChannels,
  };
  const written = writeListenerArm({ arm, home });
  if (written.isErr()) {
    progressLog({ line: `could not record this listener's arm — continuing unsupervised: ${written.error.message}` });
    return;
  }
  // An arm record standing with no `armed` line behind it can be cleared later leaving no evidence this listener
  // existed, which is what `fleet-unhealthy` reads to tell a dead listener from an install that never armed one. So
  // a failed append takes the record back, and the listener runs unsupervised exactly as a failed arm write does —
  // never journal-first, because an `armed` line clears a standing escalation (`escalationStanding`).
  const journalled = appendListenerArmEvent({
    event: { armId, atIso: startedAtIso, kind: "armed", pid: arm.pid },
    home,
  });
  if (journalled.isErr()) {
    const cleared = clearListenerArm({ home });
    const residue = cleared.isErr() ? `; the arm record could not be taken back: ${cleared.error.message}` : "";
    progressLog({
      line: `could not journal this listener's arm — continuing unsupervised: ${journalled.error.message}${residue}`,
    });
    return;
  }
  // Tell the supervisor rather than making it ask. The arm journal above is what the death-watch READS to
  // decide; this is what a watching session is WOKEN by — see `events/event.ts` for why they stay apart.
  const published = publishSupervisorEvent({
    event: listenerArmedEvent({ armId, atIso: startedAtIso, pid: arm.pid }),
    home,
  });
  if (published !== undefined) {
    progressLog({ line: `could not publish the armed event to the supervisor stream — continuing: ${published}` });
  }
  progressLog({ line: `registered as arm ${armId} (pid ${String(arm.pid)}) — \`slopweaver listen status\` reads it` });
}

/**
 * The production heartbeat writer: a real 15-second interval, a real clock, and a real whole-file write
 * under the home. `unref`'d so a beat timer alone can never keep the process alive after the socket loop has
 * finished — a listener that exits cleanly must exit, not linger writing beats nobody reads.
 *
 * A failed write is NARRATED and swallowed, never thrown: losing a beat makes the supervisor re-arm, which
 * is a bounded and visible outcome; crashing the listener over a full disk is not.
 *
 * @param armId the arm id to stamp beats with
 * @param home the Slopweaver home the beat file lives under
 * @param progressLog where a failed write is narrated
 * @param scope the conversations this listener acts on, recorded on its arm
 * @param threadReplyChannels the conversations a reply under the bot's own post is an address in, recorded
 *   on its arm alongside the scope
 * @returns the writer, already ticking
 */
function liveListenerBeat({
  armId,
  home,
  progressLog,
  scope,
  threadReplyChannels,
}: {
  armId: string;
  home: string;
  progressLog: ListenLog;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): ListenerBeatWriter {
  registerThisArm({ armId, home, progressLog, scope, threadReplyChannels });
  return startListenerBeat({
    armId,
    nowIso: () => new Date().toISOString(),
    pid: process.pid,
    schedule: ({ ms, tick }) => {
      const timer = setInterval(tick, ms);
      timer.unref();
      return () => {
        clearInterval(timer);
      };
    },
    write: ({ heartbeat }) => {
      const written = writeListenerHeartbeat({ heartbeat, home });
      if (written.isErr()) {
        progressLog({ line: `could not write the supervision heartbeat — continuing: ${written.error.message}` });
      }
    },
  });
}

/**
 * {@link liveListenerBeat} for a SUPERVISED listener, and `undefined` for one somebody typed by hand.
 *
 * An unsupervised listener is a legitimate shape — it answers tags exactly the same way — so the absent arm
 * id is a case named here once rather than a branch every caller repeats.
 *
 * @param armId the arm this listener was started as, or `undefined` when it was not started through `listen arm`
 * @param home the Slopweaver home the arm and beat live under
 * @param progressLog where a failed write is narrated
 * @param scope the conversations this listener acts on, recorded on its arm
 * @param threadReplyChannels the conversations a reply under the bot's own post is an address in
 * @returns the beat writer, already ticking, or `undefined` when there is nothing to supervise
 */
export function liveListenerBeatIfSupervised({
  armId,
  home,
  progressLog,
  scope,
  threadReplyChannels,
}: {
  armId: string | undefined;
  home: string;
  progressLog: ListenLog;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): ListenerBeatWriter | undefined {
  if (armId === undefined) {
    return undefined;
  }
  return liveListenerBeat({ armId, home, progressLog, scope, threadReplyChannels });
}
