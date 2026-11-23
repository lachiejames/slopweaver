/**
 * The listener's own side of the heartbeat: a small ticker that rewrites `heartbeat.json` on a fixed
 * interval, carrying whatever socket state the loop last reported.
 *
 * Every seam is injected — the clock, the timer and the write — so the ordering this file actually owns (a
 * beat is written IMMEDIATELY on start, not one interval later; a state change is reflected by the NEXT
 * beat; `stop` writes a final `disconnected` beat) is unit-testable with no timers and no filesystem. The
 * immediate first beat matters: without it a freshly armed listener looks beat-less for a whole interval,
 * and a supervisor's grace window has to be widened to cover a gap that need not exist.
 */

import { HEARTBEAT_INTERVAL_MS, type ListenerHeartbeat, type ListenerSocketState } from "./heartbeat.js";

/** What the listener holds while it is running, to report its own liveness. */
export interface ListenerBeatWriter {
  /** Record the socket's new state; reflected by the next beat. */
  readonly noteSocketState: (args: { state: ListenerSocketState }) => void;
  /** Record that Slack delivered a frame — any frame, `ping` included. */
  readonly noteFrame: () => void;
  /** Write one beat right now, out of band. */
  readonly beatNow: () => void;
  /** Stop ticking and write one final `disconnected` beat, so a clean shutdown does not look like a kill. */
  readonly stop: () => void;
}

/**
 * Start writing heartbeats.
 *
 * @param armId the arm this listener was started as — a beat carrying another arm's id is a beat from a
 *   process the supervisor is not watching, and {@link ../supervise/liveness.listenerLiveness} refuses it
 * @param pid the writing process's own pid
 * @param nowIso the clock seam, returning ISO-8601
 * @param write where a beat goes
 * @param schedule the repeating-timer seam; returns the canceller
 * @param intervalMs how often to beat (defaults to {@link HEARTBEAT_INTERVAL_MS})
 * @returns the writer the listener holds for its lifetime
 */
export function startListenerBeat({
  armId,
  pid,
  nowIso,
  write,
  schedule,
  intervalMs = HEARTBEAT_INTERVAL_MS,
}: {
  armId: string;
  pid: number;
  nowIso: () => string;
  write: (args: { heartbeat: ListenerHeartbeat }) => void;
  schedule: (args: { ms: number; tick: () => void }) => () => void;
  intervalMs?: number;
}): ListenerBeatWriter {
  let socketState: ListenerSocketState = "connecting";
  let socketStateSinceIso = nowIso();
  let lastSocketEventAtIso: string | undefined;
  let stopped = false;

  const beat = (): void => {
    write({
      heartbeat: { armId, lastSocketEventAtIso, pid, socketState, socketStateSinceIso, writtenAtIso: nowIso() },
    });
  };

  beat();
  const cancel = schedule({ ms: intervalMs, tick: beat });

  return {
    beatNow: beat,
    noteFrame: () => {
      lastSocketEventAtIso = nowIso();
    },
    noteSocketState: ({ state }) => {
      // Only a real CHANGE restamps the clock. The loop reports a state on every attempt, and restamping on
      // an unchanged one would reset the "how long has it been down" measurement on every reconnect try —
      // which is exactly the measurement that tells a backoff apart from a dead socket.
      if (state !== socketState) {
        socketState = state;
        socketStateSinceIso = nowIso();
      }
    },
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      cancel();
      if (socketState !== "disconnected") {
        socketState = "disconnected";
        socketStateSinceIso = nowIso();
      }
      beat();
    },
  };
}
