/**
 * What the listener publishes onto the supervisor stream — pure. No clock, no filesystem.
 *
 * The arm journal (`arms.jsonl`) and this stream are NOT the same thing wearing two hats, and keeping them
 * apart is deliberate:
 *
 * - `arms.jsonl` is a DECISION INPUT. `rearmDecision` counts its deaths and `escalationStanding` reads its
 *   tail; changing what is in it changes what the supervision loop does.
 * - the supervisor stream is a NOTIFICATION. Nothing here is ever read back to make a decision, so a surface
 *   can publish onto it — a degraded heartbeat, a re-arm command handed over — without that becoming a new
 *   input to the bounded-retry contract by accident.
 *
 * ## The stream says "look now"; `listen status` says what it is NOW
 *
 * There is deliberately no `recovered` kind. A stream event is a moment, not a state, and a reader that tried
 * to hold current state by folding moments would go wrong the first time it missed one. So a supervisor woken
 * by anything here re-reads `slopweaver listen status --json` for the live grade, which is one call and
 * cannot be stale. Inventing a recovery event to spare it that call would trade a cheap certainty for a fold
 * that can silently disagree with the process it describes.
 */

import type { ListenerEventKind, ListenerStreamEvent, SupervisorEvent } from "../../../events/event.js";
import { slackTsToEpochMs, slackTsToIso } from "../../../lib/slackTs.js";
import type { ListenerDeathReason } from "./rearm.js";
import type { ListenerGrade } from "./report.js";

/**
 * The listener registered itself and is holding the socket.
 *
 * @param armId the arm that started
 * @param atIso when it started
 * @param pid the process holding the Socket Mode connection
 * @returns the event to publish
 */
export function listenerArmedEvent({
  armId,
  atIso,
  pid,
}: {
  armId: string;
  atIso: string;
  pid: number;
}): ListenerStreamEvent {
  return {
    armId,
    atIso,
    kind: "armed",
    pid,
    source: "listener",
    why: `the Slack listener is up — arm ${armId}, pid ${String(pid)}. A tag arriving now is captured.`,
  };
}

/**
 * Somebody cleared the arm record on purpose.
 *
 * @param armId the arm that was cleared
 * @param atIso when it was cleared
 * @param pid the pid that was on record
 * @returns the event to publish
 */
export function listenerDisarmedEvent({
  armId,
  atIso,
  pid,
}: {
  armId: string;
  atIso: string;
  pid: number;
}): ListenerStreamEvent {
  return {
    armId,
    atIso,
    kind: "disarmed",
    pid,
    source: "listener",
    why: `arm ${armId} (pid ${String(pid)}) was disarmed deliberately — the bot is DOWN because someone said so.`,
  };
}

/**
 * The tick observed a listener that is neither healthy nor dead — starting, or off the socket and inside its
 * normal backoff.
 *
 * EDGE-TRIGGERED against the newest listener event already on the stream. A reconnect can take several ticks,
 * and a stream that repeated the same warning every fifteen seconds would be a stream its reader learns to
 * skip — which is the same failure as not publishing at all.
 *
 * @param armId the arm this is about
 * @param atIso when the tick ran
 * @param grade the tick's grade
 * @param pid the arm's pid
 * @param previousKind the newest listener event already published, or `undefined` when there is none
 * @param why the tick's own one-line rendering of the verdict
 * @returns the event to publish, or `undefined` when the grade is not degraded or the warning already stands
 */
export function listenerDegradedEvent({
  armId,
  atIso,
  grade,
  pid,
  previousKind,
  why,
}: {
  armId: string | undefined;
  atIso: string;
  grade: ListenerGrade;
  pid: number | undefined;
  previousKind: ListenerEventKind | undefined;
  why: string;
}): ListenerStreamEvent | undefined {
  if (grade !== "degraded" || previousKind === "heartbeat-degraded") {
    return undefined;
  }
  return { armId, atIso, kind: "heartbeat-degraded", pid, source: "listener", why };
}

/**
 * What the tick publishes about a death it just observed — the death itself, and then what it decided to do
 * about it.
 *
 * Always two events, never one merged "died-and-rearmed": a supervisor filtering for `alert` must see the
 * death whether or not the response was routine, and a reader that only ever sees the response cannot tell a
 * first outage from a third. The two halves are exported separately as {@link listenerDiedEvent} and
 * {@link listenerResponseEvent}, because `listen reconcile` publishes the first without ever producing the
 * second.
 *
 * @param armId the arm that died
 * @param atIso when the death was observed
 * @param deathsInWindow how many deaths that makes inside the re-arm window
 * @param escalatedWhy the escalation sentence when the tick escalated, `undefined` when it re-armed
 * @param lastLog the tail of the dead arm's own log, when there was one to read
 * @param pid the dead arm's pid
 * @param reason how the tick knew it was dead
 * @returns the events to publish, in order
 */
export function listenerDeathEvents({
  armId,
  atIso,
  deathsInWindow,
  escalatedWhy,
  lastLog,
  pid,
  reason,
}: {
  armId: string;
  atIso: string;
  deathsInWindow: number;
  escalatedWhy: string | undefined;
  lastLog: string | undefined;
  pid: number;
  reason: ListenerDeathReason;
}): readonly ListenerStreamEvent[] {
  return [
    listenerDiedEvent({ armId, atIso, deathsInWindow, lastLog, pid, reason }),
    listenerResponseEvent({ armId, atIso, escalatedWhy, pid }),
  ];
}

/**
 * The death on its own — for a caller that publishes the death and the response at different moments.
 *
 * `listen reconcile` is that caller. It back-writes deaths nobody watched and then STOPS: it neither re-arms
 * nor escalates, because a verb any session may tick must not be able to leave the bot deliberately DOWN. So
 * it publishes this and no follow-up, and a `re-armed` event from it would be a straight lie — nothing was
 * re-armed.
 *
 * A `superseded` reason renders differently on purpose. It means the arm ENDED and no live observer saw how,
 * which is a weaker claim than the five observed verdicts, and a stream event that stated it as flatly as
 * `process-dead` would be asserting more than the journal knows.
 *
 * @param armId the arm that died
 * @param atIso when it died — for a reconciled death, the tightest lower bound, not the discovery time
 * @param deathsInWindow how many deaths that makes inside the re-arm window
 * @param lastLog the tail of the dead arm's own log, when there was one to read
 * @param pid the dead arm's pid
 * @param reason how it was known to be dead
 * @returns the event to publish
 */
export function listenerDiedEvent({
  armId,
  atIso,
  deathsInWindow,
  lastLog,
  pid,
  reason,
}: {
  armId: string;
  atIso: string;
  deathsInWindow: number;
  lastLog: string | undefined;
  pid: number;
  reason: ListenerDeathReason;
}): ListenerStreamEvent {
  const what =
    reason === "superseded"
      ? `the Slack listener arm ${armId} (pid ${String(pid)}) ENDED and nothing watched it go — a later arm ` +
        "replaced it with no death, disarm or escalation journalled in between"
      : `the Slack listener DIED (${reason}) — arm ${armId}, pid ${String(pid)}`;
  return {
    armId,
    atIso,
    kind: "died",
    pid,
    source: "listener",
    why:
      `${what}. That is death ${String(deathsInWindow)} inside the re-arm window; the bot is off the air ` +
      "until something arms it.",
    ...(lastLog === undefined ? {} : { lastLog }),
  };
}

/**
 * What the tick decided to DO about a death — the second half of {@link listenerDeathEvents}.
 *
 * `re-armed` names what actually happened, which is that the tick handed a command back to the visible
 * session — the listener is not up again until it registers itself and publishes its own `armed`. The `why`
 * says so rather than letting the kind imply a live process.
 *
 * @param armId the arm that died
 * @param atIso when the tick ran
 * @param escalatedWhy the escalation sentence when the tick escalated, `undefined` when it re-armed
 * @param pid the dead arm's pid
 * @returns the event to publish
 */
export function listenerResponseEvent({
  armId,
  atIso,
  escalatedWhy,
  pid,
}: {
  armId: string;
  atIso: string;
  escalatedWhy: string | undefined;
  pid: number;
}): ListenerStreamEvent {
  if (escalatedWhy !== undefined) {
    return { armId, atIso, kind: "escalated", pid: undefined, source: "listener", why: escalatedWhy };
  }
  return {
    armId,
    atIso,
    kind: "re-armed",
    pid,
    source: "listener",
    why:
      "a re-arm command was handed back to the visible session — the listener is not up again until it " +
      "registers itself and publishes `armed`.",
  };
}

/** How long a recovery watermark may sit still under a healthy listener before the sweep gripes about it. */
export const RECOVERY_STALLED_AFTER_MS = 60 * 60 * 1000;

/**
 * What a scheduled recovery sweep publishes when its watermark has been pinned for longer than
 * {@link RECOVERY_STALLED_AFTER_MS} while the listener itself is fine.
 *
 * A stale watermark under a DOWN or UNARMED listener is not this event: the outage is already the alert (or
 * nobody is running the bot at all), and a second alarm for its consequence would be the noise that trains a
 * reader to ignore the stream. A `degraded` listener still counts, because a socket mid-reconnect does not
 * explain a sweep that has failed to complete for an hour. Edge-triggered against the stream's own tail the
 * same way {@link listenerDegradedEvent} is: a sweep runs every five minutes, and twelve identical alerts an
 * hour say nothing the first did not.
 *
 * @param atIso when the sweep finished
 * @param completedThroughTs the durable watermark, as a Slack decimal `ts`, or `undefined` before any
 *   complete sweep has ever run
 * @param failures how many coverage failures this sweep reported — carried into the sentence so a reader
 *   knows whether to look at `failures` or at a listener that is not sweeping at all
 * @param grade the listener's grade at the moment the sweep finished
 * @param nowMs the current instant, epoch milliseconds
 * @param previousKind the newest listener event already published, or `undefined` when there is none
 * @param armId the arm that is healthy while recovery is not, or `undefined` when unknown
 * @param pid that arm's pid, or `undefined` when unknown
 * @returns the event to publish, or `undefined` when the watermark is fresh, the listener is not healthy or
 *   degraded, no watermark has ever been established, or the warning already stands
 */
export function recoveryStalledEvent({
  atIso,
  completedThroughTs,
  failures,
  grade,
  nowMs,
  previousKind,
  armId,
  pid,
}: {
  atIso: string;
  completedThroughTs: string | undefined;
  failures: number;
  grade: ListenerGrade;
  nowMs: number;
  previousKind: ListenerEventKind | undefined;
  armId: string | undefined;
  pid: number | undefined;
}): ListenerStreamEvent | undefined {
  if (completedThroughTs === undefined || (grade !== "healthy" && grade !== "degraded")) {
    return undefined;
  }
  if (previousKind === "recovery-stalled") {
    return undefined;
  }
  const watermarkMs = slackTsToEpochMs({ ts: completedThroughTs });
  const watermarkIso = slackTsToIso({ ts: completedThroughTs });
  if (watermarkMs === undefined || watermarkIso === undefined) {
    return undefined;
  }
  const staleMs = nowMs - watermarkMs;
  if (!Number.isFinite(staleMs) || staleMs < RECOVERY_STALLED_AFTER_MS) {
    return undefined;
  }
  const staleHours = (staleMs / 3_600_000).toFixed(1);
  const why =
    `recovery watermark pinned at ${watermarkIso} (${staleHours}h ago) while the listener ` +
    `is ${grade}: every sweep since has been partial (${String(failures)} failure(s) on the latest), so a tag ` +
    "missed during an outage is NOT being picked up — read the sweep's own `failures`";
  return { armId, atIso, kind: "recovery-stalled", pid, source: "listener", why };
}

/**
 * The newest listener event on a stream, for the edge-trigger {@link listenerDegradedEvent} needs.
 *
 * @param events the stream's events, in file order
 * @returns the newest listener event's kind, or `undefined` when the stream carries none
 */
export function newestListenerKind({ events }: { events: readonly SupervisorEvent[] }): ListenerEventKind | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.source === "listener") {
      return event.kind;
    }
  }
  return undefined;
}
