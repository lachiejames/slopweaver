/**
 * What Slack last said about this app's Socket Mode connection count, and how `listen arm` reports it
 * before opening another one. Pure — no clock, no filesystem; `store.ts` owns both.
 *
 * ## Why an OBSERVATION and not a count
 *
 * Nothing on this machine can compute how many Socket Mode connections a Slack app holds. Measured
 * (repro: `grep <date> ~/.slopweaver/live/listener/arms.jsonl`): the arm journal recorded
 * THREE arms across the nine hours before an arm was told it was the tenth connection. A count
 * derived from local arm history would have printed `3` at the exact moment the true answer was `10`.
 * Three reasons it undercounts, none of them fixable locally — every reconnect inside one long-lived
 * `--follow` arm opens a fresh socket (`../appsConnections.ts`: "every connection attempt opens a fresh
 * one") while the journal records one `armed` event for the whole arm; another home, worktree or machine
 * on the same app token spends the same app-wide cap and journals somewhere this process cannot read; and
 * the retention is Slack-side, which is the whole finding — a closed socket keeps counting for tens of
 * minutes after its process is gone.
 *
 * So the only honest source is Slack's own `hello` frame, which is where {@link ../connections.ts}'s
 * permit already reads `num_connections` — and, until this module existed, where the number was DISCARDED
 * after one in-process decision. What is kept is therefore a dated observation with an author, never a
 * live gauge, and every line rendered here says so.
 *
 * ## Why it reports and never refuses
 *
 * `listen arm` is the one action that recovers a down loop, and this observation is a floor of unknown
 * staleness. A refusal built on it would block on a stale 10 that has long since drained just as readily
 * as it would wave through a stale 1. The enforcement point stays exactly where it already is —
 * `socketConnectionPermit`, at the `hello` frame, on the authoritative number.
 */

import { parseIsoMs } from "../../../lib/date.js";
import { isRecord } from "../../../lib/parsers.js";
import { humanDuration } from "../../../lib/progressRender.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { MULTIPLE_CONNECTIONS_GRACE_MS } from "../connections.js";
import { type ListenerStateError, ListenerStateErrors } from "./errors.js";

/**
 * Slack's own ceiling on simultaneous Socket Mode connections per app. Reported as context for a reading,
 * never as this repo's own threshold: `socketConnectionPermit` refuses at TWO, because a tag is
 * load-balanced across every open connection and only one of them answers.
 */
export const SLACK_SOCKET_CONNECTION_CAP = 10;

/** The last `hello` any listener on this home saw, kept whole so a later reader can judge its age. */
export interface SocketConnectionObservation {
  /** What that `hello`'s `num_connections` reported. */
  readonly connections: number;
  /** When the frame arrived, ISO-8601 — the instant the reading is about, never when it was written. */
  readonly observedAtIso: string;
  /**
   * The arm whose connection saw it, when the listener was a supervised one — kept because the reading
   * routinely outlives the arm that took it. A hand-typed `listen --follow` has no arm, and the reading is
   * about the APP rather than the arm, so it is recorded either way and this field is simply absent.
   */
  readonly armId?: string;
  /** That arm's pid, so a reading can be tied back to one process's own log. */
  readonly pid: number;
}

/**
 * Validate an already-JSON-parsed value as a {@link SocketConnectionObservation}.
 *
 * Every field is checked rather than trusted, like {@link ./heartbeat.parseListenerHeartbeat}: a half-written
 * record read as a valid one would put a fabricated number in front of an operator at the one moment this
 * whole module exists to inform.
 *
 * @param raw the parsed JSON value read from disk
 * @returns the validated observation, or the error naming the first field that did not match
 */
export function parseSocketConnectionObservation({
  raw,
}: {
  raw: unknown;
}): Result<SocketConnectionObservation, ListenerStateError> {
  if (!isRecord(raw)) {
    return err(ListenerStateErrors.invalid({ field: "socketConnections", found: raw }));
  }
  const connections = raw["connections"];
  if (typeof connections !== "number" || !Number.isSafeInteger(connections) || connections < 0) {
    return err(ListenerStateErrors.invalid({ field: "connections", found: connections }));
  }
  const observedAtIso = raw["observedAtIso"];
  if (typeof observedAtIso !== "string" || !Number.isFinite(Date.parse(observedAtIso))) {
    return err(ListenerStateErrors.invalid({ field: "observedAtIso", found: observedAtIso }));
  }
  const armId = raw["armId"];
  if (armId !== undefined && (typeof armId !== "string" || armId.length === 0)) {
    return err(ListenerStateErrors.invalid({ field: "armId", found: armId }));
  }
  const pid = raw["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return err(ListenerStateErrors.invalid({ field: "pid", found: pid }));
  }
  return ok({ connections, observedAtIso, pid, ...(armId === undefined ? {} : { armId }) });
}

/**
 * How long ago a reading was taken, rendered — never two instants for a reader to subtract.
 *
 * A reading stamped in the future (two machines, one home, disagreeing clocks) renders as `0s` rather than
 * a negative age: the age is evidence about staleness, and a negative one says nothing true.
 */
function ageOf({ observedAtIso, nowMs }: { observedAtIso: string; nowMs: number }): string | undefined {
  const observedMs = parseIsoMs({ tsIso: observedAtIso });
  if (observedMs === undefined) {
    return undefined;
  }
  return humanDuration({ seconds: Math.max(0, nowMs - observedMs) / 1000 });
}

/** The reading itself, as one line — with its age when the stamp parses, and without when it does not. */
function readingLine({ observation, nowMs }: { observation: SocketConnectionObservation; nowMs: number }): string {
  const count = `${String(observation.connections)} of ${String(SLACK_SOCKET_CONNECTION_CAP)}`;
  const author =
    observation.armId === undefined
      ? `pid ${String(observation.pid)}`
      : `arm ${observation.armId}, pid ${String(observation.pid)}`;
  const age = ageOf({ nowMs, observedAtIso: observation.observedAtIso });
  if (age === undefined) {
    return `Slack last reported ${count} Socket Mode connections for this app at ${observation.observedAtIso} (${author})`;
  }
  return `Slack last reported ${count} Socket Mode connections for this app, ${age} ago (${author})`;
}

/**
 * What `listen arm` prints about the app's connection budget before it prints the command to run.
 *
 * Three cases, and the no-reading case is as loud as the others — an arm opening blind should say so
 * rather than print nothing, because silence at this exact moment is the defect this budget exists to prevent:
 * the arm record was written, `listen status` named a pid, and the refusal only reached a dead process's
 * stderr seconds later.
 *
 * @param observation the last reading on this home, or `undefined` when none has ever been taken
 * @param nowMs the clock, injected so this stays pure
 * @returns the lines to narrate, in order
 */
export function armConnectionLines({
  observation,
  nowMs,
}: {
  observation: SocketConnectionObservation | undefined;
  nowMs: number;
}): readonly string[] {
  if (observation === undefined) {
    return [
      "no Socket Mode connection count has ever been observed on this home, so this arm opens blind — " +
        `Slack reports one only in the \`hello\` frame, and caps this app at ${String(SLACK_SOCKET_CONNECTION_CAP)} connections`,
    ];
  }
  const lines = [
    readingLine({ nowMs, observation }),
    "that is a FLOOR, not a live count: a closed socket keeps counting against the cap for tens of " +
      "minutes after its process is gone, and this is only the last `hello` a listener on this home saw",
  ];
  if (observation.connections > 1) {
    lines.push(
      "more than one connection was open at that reading, so this arm is likely to be REFUSED at `hello` " +
        `and retry for up to ${humanDuration({ seconds: MULTIPLE_CONNECTIONS_GRACE_MS / 1000 })} while Slack's ` +
        "count drains, exiting only if it still reports more than one — nothing local frees a slot",
    );
  }
  return lines;
}
