/**
 * The one shape a SUPERVISOR reads to answer "what is the Slack socket doing, and is something wrong?" —
 * pure, assembled from the three signals a caller has already read.
 *
 * The supervisor session needs visibility into what the Slack socket is doing — its current state, and a
 * confident signal when something is wrong. The reason it matters: the problem is never a missed tag, it is an
 * agent reporting the socket died while no one knows why.
 *
 * So this report is built to be read by a sweep on a tick, not by a human squinting at a log. It answers in
 * one graded word, carries the numbers behind that word, and — because "no one knows why" is the actual
 * complaint — carries the last death's REASON and the evidence captured with it rather than leaving the
 * caller to go and find the log.
 *
 * ## Four grades, not three
 *
 * The ask named three (healthy / degraded / down). There are four here, and the extra one earns its place:
 * `unarmed` is not the same fault as `down`. `unarmed` means no listener is running at all, which is the
 * correct and expected state whenever no live-loop session is up — a supervisor that graded it `down` would
 * raise an alarm every night. `down` means a listener is supposed to be running and is not answering. A
 * supervisor needs those apart to know whether to act, and collapsing them is how a monitor trains its reader
 * to ignore it.
 */

import { heartbeatAgeMs, type ListenerHeartbeat, type ListenerSocketState } from "./heartbeat.js";
import type { ListenerArm, ListenerLiveness } from "./liveness.js";
import { escalationStanding, type ListenerArmEvent, type ListenerDeathReason, REARM_WINDOW_MS } from "./rearm.js";

/** How wrong things are, in one word a sweep can branch on. */
export type ListenerGrade = "healthy" | "degraded" | "down" | "unarmed";

/** What the last death was, when one is on record. */
interface ListenerLastDeath {
  readonly atIso: string;
  readonly reason: ListenerDeathReason;
  readonly armId: string;
  /**
   * The tail of the dead arm's own log, captured AT the moment of death.
   *
   * This is the field the whole report exists for. "The socket died and no one knows why" is not solved by
   * recording that it died — it is solved by keeping what the process was saying as it went. Captured rather
   * than inferred: nothing here guesses a cause, it stores the evidence a human reads to find one.
   * `undefined` when the log could not be read (a foreground arm writes to the session's own output, not to
   * a file), which is stated rather than papered over with an empty string.
   */
  readonly lastLog: string | undefined;
}

/** Everything a supervisor's tick needs, in one object. */
export interface ListenerReport {
  readonly grade: ListenerGrade;
  /** One sentence: what state it is in and why that grade. */
  readonly why: string;
  readonly armId: string | undefined;
  readonly pid: number | undefined;
  readonly socketState: ListenerSocketState | undefined;
  /** How long since Slack last delivered ANY frame — `ping` included. `undefined` before the first. */
  readonly lastEventAgoMs: number | undefined;
  /** How long since the listener last wrote a beat. `undefined` when it has never written one. */
  readonly heartbeatAgoMs: number | undefined;
  /** Deaths journalled inside the re-arm window — the number the escalation threshold counts. */
  readonly deathsInWindow: number;
  readonly lastDeath: ListenerLastDeath | undefined;
  /** Whether an escalation is standing, so nothing will be armed automatically until a person acts. */
  readonly escalated: boolean;
  /**
   * The channels a reply under one of the bot's own posts is an address in — empty when the feature is off.
   *
   * Always present, never absent, so a machine reader never has to tell "off" from "this build does not
   * report it". Before this field the ONLY witness that thread-reply addressing was live was the running
   * process's argv: the arm record did not carry it and no status surface named it, so a session inheriting
   * the install could not tell the feature was on, or for which channel.
   */
  readonly threadReplyChannels: readonly string[];
  /** The raw liveness verdict, for a caller that wants the full discrimination rather than the grade. */
  readonly liveness: ListenerLiveness;
}

/**
 * The grade one verdict maps to.
 *
 * Exported because the death-watch tick grades a verdict without assembling a whole report — it publishes a
 * degraded listener onto the supervisor stream, and re-deriving "which states count as degraded" beside this
 * switch is exactly how two answers to the same question drift apart.
 *
 * @param liveness the verdict to grade
 * @returns the one-word grade
 */
export function listenerGrade({ liveness }: { liveness: ListenerLiveness }): ListenerGrade {
  switch (liveness.state) {
    case "unarmed":
      return "unarmed";
    case "starting":
    case "reconnecting":
      return "degraded";
    case "healthy":
      return "healthy";
    case "process-dead":
    case "heartbeat-missing":
    case "heartbeat-foreign":
    case "heartbeat-stale":
    case "socket-down":
      return "down";
  }
}

/** The newest journalled death, or `undefined` when none is on record. */
function lastDeathOf({ events }: { events: readonly ListenerArmEvent[] }): ListenerLastDeath | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind === "died") {
      return { armId: event.armId, atIso: event.atIso, lastLog: event.lastLog, reason: event.reason };
    }
  }
  return undefined;
}

/** How many deaths fall inside the re-arm window. */
function deathsInWindowOf({
  events,
  nowMs,
  windowMs,
}: {
  events: readonly ListenerArmEvent[];
  nowMs: number;
  windowMs: number;
}): number {
  const since = nowMs - windowMs;
  return events.filter((event) => {
    if (event.kind !== "died") {
      return false;
    }
    const atMs = Date.parse(event.atIso);
    return atMs >= since && atMs <= nowMs;
  }).length;
}

/**
 * Assemble the supervisor's report.
 *
 * @param arm the current arm record, or `undefined` when nothing is registered
 * @param events every journalled arm event, in file order
 * @param heartbeat the newest heartbeat, or `undefined` when none is readable
 * @param liveness the verdict already computed from those signals
 * @param nowMs the current instant, epoch milliseconds
 * @param windowMs the re-arm window deaths are counted over (defaults to {@link REARM_WINDOW_MS})
 * @param why the one-sentence rendering of `liveness` this report should carry
 * @returns the report
 */
export function listenerReport({
  arm,
  events,
  heartbeat,
  liveness,
  nowMs,
  why,
  windowMs = REARM_WINDOW_MS,
}: {
  arm: ListenerArm | undefined;
  events: readonly ListenerArmEvent[];
  heartbeat: ListenerHeartbeat | undefined;
  liveness: ListenerLiveness;
  nowMs: number;
  why: string;
  windowMs?: number;
}): ListenerReport {
  const lastEventAtIso = heartbeat?.lastSocketEventAtIso;
  return {
    armId: arm?.armId,
    deathsInWindow: deathsInWindowOf({ events, nowMs, windowMs }),
    escalated: escalationStanding({ events }),
    grade: listenerGrade({ liveness }),
    heartbeatAgoMs: heartbeat === undefined ? undefined : heartbeatAgeMs({ heartbeat, nowMs }),
    lastDeath: lastDeathOf({ events }),
    lastEventAgoMs: lastEventAtIso === undefined ? undefined : nowMs - Date.parse(lastEventAtIso),
    liveness,
    pid: arm?.pid,
    socketState: heartbeat?.socketState,
    threadReplyChannels: arm === undefined ? [] : arm.threadReplyChannels,
    why,
  };
}
