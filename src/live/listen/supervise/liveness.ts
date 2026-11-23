/**
 * The arm record, and the one pure function that turns (arm, pid-alive, heartbeat) into a liveness verdict.
 *
 * ## A check that can actually fail
 *
 * The monitor this replaces ran `pgrep -f "src/cli/index.ts listen --follow"` — a pattern that appeared in
 * the MONITOR'S OWN command line, so `pgrep` matched the monitor's shell whether or not a listener existed.
 * It reported "alive" twice while the bot was deaf, and the obvious `[i]ndex.ts` fix does not
 * help: any command-line pattern the monitor embeds self-matches. The lesson generalises past `pgrep` —
 * before trusting a liveness check, ask whether it would emit if the thing were dead RIGHT NOW.
 *
 * {@link listenerLiveness} is written to answer that question yes. It is pure, it takes the two observations
 * as parameters rather than making them, and every one of its verdicts is reachable from a plain unit test —
 * including the one a pidfile alone cannot produce, `socket-down`: process in the table, socket gone.
 */

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type ListenScope, scopeFromRecord } from "../scope.js";
import { threadReplyChannelsFromRecord } from "../threadReply.js";
import { type ListenerStateError, ListenerStateErrors } from "./errors.js";
import {
  HEARTBEAT_GRACE_MS,
  heartbeatAgeMs,
  isHeartbeatStale,
  type ListenerHeartbeat,
  SOCKET_DOWN_AFTER_MS,
  socketStateAgeMs,
} from "./heartbeat.js";

/** The durable record of the listener process a supervisor is currently watching. */
export interface ListenerArm {
  /** This arm's own id — carried into its heartbeat and its per-arm log file name. */
  readonly armId: string;
  /**
   * The detached listener's pid — and, because `arm` detaches it, also its process-GROUP id.
   *
   * That equality is load-bearing rather than incidental. Measured live: the bundled launcher
   * `exec`s `tsx`, and `tsx` then FORKS the process that actually opens the socket, so the tree is
   * leader → listener → esbuild and the pid that writes the heartbeat is NOT this one. A supervisor that
   * signalled only this pid would orphan a live listener still holding the Socket Mode connection, then arm
   * a second one beside it. Every kill this supervisor sends therefore targets the GROUP (`-pid`).
   */
  readonly pid: number;
  /** When it was started, ISO-8601. */
  readonly startedAtIso: string;
  /** The per-arm log file this arm's stdout and stderr were redirected to. Never shared with another arm. */
  readonly logPath: string;
  /**
   * The conversations this arm acts on, so a re-arm after its death stays inside them rather than silently
   * going live everywhere. A record written before scoping existed carries none and reads as unscoped.
   */
  readonly scope: ListenScope;
  /**
   * The conversations a reply under one of the bot's OWN posts counts as an address in — recorded for the
   * same reason {@link scope} is, in the other direction. A re-arm that dropped these would take the feature
   * away from the channels an operator switched it on for, and the only symptom would be replies going
   * unanswered. A record written before this field existed carries none and reads as switched off.
   *
   * The consequence to know before switching a channel on: this SURVIVES a death, so letting the arm die is
   * no longer how it goes off. Switching it off is a deliberate `listen arm` without the flag.
   */
  readonly threadReplyChannels: readonly string[];
}

/**
 * Validate an already-JSON-parsed value as a {@link ListenerArm}.
 *
 * @param raw the parsed JSON value read from disk
 * @returns the validated arm record, or the error naming the first field that did not match
 */
export function parseListenerArm({ raw }: { raw: unknown }): Result<ListenerArm, ListenerStateError> {
  if (!isRecord(raw)) {
    return err(ListenerStateErrors.invalid({ field: "arm", found: raw }));
  }
  const armId = raw["armId"];
  if (typeof armId !== "string" || armId.length === 0) {
    return err(ListenerStateErrors.invalid({ field: "armId", found: armId }));
  }
  const pid = raw["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return err(ListenerStateErrors.invalid({ field: "pid", found: pid }));
  }
  const startedAtIso = raw["startedAtIso"];
  if (typeof startedAtIso !== "string" || !Number.isFinite(Date.parse(startedAtIso))) {
    return err(ListenerStateErrors.invalid({ field: "startedAtIso", found: startedAtIso }));
  }
  const logPath = raw["logPath"];
  if (typeof logPath !== "string" || logPath.length === 0) {
    return err(ListenerStateErrors.invalid({ field: "logPath", found: logPath }));
  }
  const scope = scopeFromRecord({ raw: raw["scope"] });
  if (scope === undefined) {
    return err(ListenerStateErrors.invalid({ field: "scope", found: raw["scope"] }));
  }
  const threadReplyChannels = threadReplyChannelsFromRecord({ raw: raw["threadReplyChannels"] });
  if (threadReplyChannels === undefined) {
    return err(ListenerStateErrors.invalid({ field: "threadReplyChannels", found: raw["threadReplyChannels"] }));
  }
  return ok({ armId, logPath, pid, scope, startedAtIso, threadReplyChannels });
}

/**
 * What a supervisor concluded about the listener. Every variant except `healthy` and `starting` means the
 * bot is deaf right now.
 */
export type ListenerLiveness =
  /** No arm record at all — nothing is being supervised. A tag arriving now is a no-op BY DESIGN. */
  | { readonly state: "unarmed" }
  /** Armed, within the heartbeat grace window, and no beat written yet. Not death; not health either. */
  | { readonly state: "starting"; readonly armId: string; readonly pid: number; readonly armAgeMs: number }
  /** The pid is gone from the process table. This is the shape both measured kills took. */
  | { readonly state: "process-dead"; readonly armId: string; readonly pid: number }
  /** The process is alive but has written no heartbeat since well past the grace window. */
  | { readonly state: "heartbeat-missing"; readonly armId: string; readonly pid: number; readonly armAgeMs: number }
  /** The newest beat on disk belongs to an arm that is no longer the one being supervised. */
  | {
      readonly state: "heartbeat-foreign";
      readonly armId: string;
      readonly pid: number;
      readonly heartbeatArmId: string;
    }
  /** The process is alive and the beat is this arm's, but it stopped being written. */
  | { readonly state: "heartbeat-stale"; readonly armId: string; readonly pid: number; readonly ageMs: number }
  /**
   * Process alive, beat fresh, socket not connected but not for long enough to call it dead. A reconnect
   * backing off is this, not a fault — see {@link ../supervise/heartbeat.SOCKET_DOWN_AFTER_MS}.
   */
  | { readonly state: "reconnecting"; readonly armId: string; readonly pid: number; readonly socketDownMs: number }
  /** Process alive, beat fresh, socket gone for longer than a reconnect could explain — the failure a pidfile check can never see. */
  | { readonly state: "socket-down"; readonly armId: string; readonly pid: number; readonly socketDownMs: number }
  /** Process alive, beat fresh, socket connected. */
  | { readonly state: "healthy"; readonly armId: string; readonly pid: number; readonly ageMs: number };

/**
 * Whether a verdict means the bot is deaf and the supervisor should act.
 *
 * `starting` and `unarmed` are deliberately NOT down: the first is a listener mid-handshake, and the second
 * is the by-design no-op state a tag arrives into when nothing is running at all.
 *
 * @param liveness the verdict to judge
 * @returns true when the listener is not currently able to receive a tag
 */
export function isListenerDown({ liveness }: { liveness: ListenerLiveness }): boolean {
  return (
    liveness.state === "process-dead" ||
    liveness.state === "heartbeat-missing" ||
    liveness.state === "heartbeat-foreign" ||
    liveness.state === "heartbeat-stale" ||
    liveness.state === "socket-down"
  );
}

/**
 * Judge the listener from two observations a caller made and one clock reading.
 *
 * Ordering is deliberate and is the contract: process death outranks everything (a beat can outlive its
 * writer by up to its own tolerance), then a beat from the wrong arm, then a missing or stale beat, then the
 * socket's own state. Reversing any two of those lets a fresher-looking signal mask a deader one.
 *
 * @param arm the arm record being supervised, or `undefined` when nothing is armed
 * @param pidAlive whether the caller's own `kill -0` (or equivalent) found the pid in the process table
 * @param heartbeat the newest heartbeat on disk, or `undefined` when none is readable
 * @param nowMs the current instant, epoch milliseconds
 * @param staleAfterMs how long a beat stays believable — threaded through to {@link isHeartbeatStale}
 * @param graceMs how long after arming a missing beat is still tolerated (defaults to {@link HEARTBEAT_GRACE_MS})
 * @param socketDownAfterMs how long an un-connected socket is still a reconnect rather than a death
 *   (defaults to {@link SOCKET_DOWN_AFTER_MS})
 * @returns the verdict
 */
export function listenerLiveness({
  arm,
  pidAlive,
  heartbeat,
  nowMs,
  staleAfterMs,
  graceMs = HEARTBEAT_GRACE_MS,
  socketDownAfterMs = SOCKET_DOWN_AFTER_MS,
}: {
  arm: ListenerArm | undefined;
  pidAlive: boolean;
  heartbeat: ListenerHeartbeat | undefined;
  nowMs: number;
  staleAfterMs?: number;
  graceMs?: number;
  socketDownAfterMs?: number;
}): ListenerLiveness {
  if (arm === undefined) {
    return { state: "unarmed" };
  }
  const { armId, pid } = arm;
  if (!pidAlive) {
    return { armId, pid, state: "process-dead" };
  }
  const armAgeMs = nowMs - Date.parse(arm.startedAtIso);
  if (heartbeat === undefined) {
    return armAgeMs <= graceMs
      ? { armAgeMs, armId, pid, state: "starting" }
      : { armAgeMs, armId, pid, state: "heartbeat-missing" };
  }
  if (heartbeat.armId !== armId) {
    return armAgeMs <= graceMs
      ? { armAgeMs, armId, pid, state: "starting" }
      : { armId, heartbeatArmId: heartbeat.armId, pid, state: "heartbeat-foreign" };
  }
  return verdictFromBeat({ armId, heartbeat, nowMs, pid, socketDownAfterMs, staleAfterMs });
}

/**
 * The three verdicts a fresh, correctly-attributed beat can produce: stale, socket-troubled, or healthy.
 *
 * Split out of {@link listenerLiveness} so the ordering above (process, then attribution, then beat) stays
 * readable as its own sequence rather than one long chain of guards.
 *
 * @param armId the supervised arm's id
 * @param heartbeat the beat, already confirmed to belong to this arm
 * @param nowMs the current instant, epoch milliseconds
 * @param pid the arm's pid
 * @param socketDownAfterMs how long an un-connected socket is still a reconnect rather than a death
 * @param staleAfterMs how long a beat stays believable
 * @returns the verdict
 */
function verdictFromBeat({
  armId,
  heartbeat,
  nowMs,
  pid,
  socketDownAfterMs,
  staleAfterMs,
}: {
  armId: string;
  heartbeat: ListenerHeartbeat;
  nowMs: number;
  pid: number;
  socketDownAfterMs: number;
  staleAfterMs: number | undefined;
}): ListenerLiveness {
  const ageMs = heartbeatAgeMs({ heartbeat, nowMs });
  if (isHeartbeatStale({ heartbeat, nowMs, ...(staleAfterMs === undefined ? {} : { staleAfterMs }) })) {
    return { ageMs, armId, pid, state: "heartbeat-stale" };
  }
  if (heartbeat.socketState !== "connected") {
    const socketDownMs = socketStateAgeMs({ heartbeat, nowMs });
    return socketDownMs > socketDownAfterMs
      ? { armId, pid, socketDownMs, state: "socket-down" }
      : { armId, pid, socketDownMs, state: "reconnecting" };
  }
  return { ageMs, armId, pid, state: "healthy" };
}
