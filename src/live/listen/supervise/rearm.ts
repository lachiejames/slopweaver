/**
 * The re-arm/escalate decision, and the append-only arm journal it reads. Pure — no clock, no filesystem.
 *
 * ## Why this is a counter and not a retry loop
 *
 * `AGENTS.md` rule 2 forbids a resident executor, and `skills/loop/SKILL.md` forbids a blind retry loop. An
 * automatic re-arm is neither of those as long as it can STOP: the supervisor re-arms a listener that died,
 * but once deaths cluster it stops re-arming and records a durable question for the owner instead. The threshold is set by the loop session itself: a third kill gets a durable `handover ask` rather
 * than a fourth silent re-arm, because at that point re-arming IS the blind retry-loop that rule forbids.
 * This module is that rule made into the contract rather than a judgement call re-made each night.
 *
 * The window matters as much as the count. Three deaths over three days is a listener that runs fine and
 * occasionally loses a socket; three deaths inside fifteen minutes is something eating the process, and
 * re-arming into it just produces a fourth corpse.
 */

import { isRecord } from "../../../lib/parsers.js";

/** How many deaths inside {@link REARM_WINDOW_MS} are tolerated before the supervisor escalates instead. */
export const MAX_DEATHS_PER_WINDOW = 3;

/** The window deaths are counted over — fifteen minutes, which is the span the measured cluster took. */
export const REARM_WINDOW_MS = 900_000;

/**
 * Why the supervisor decided a listener had died.
 *
 * The first five are the names {@link ../supervise/liveness.ts} produces, each OBSERVED on a live process.
 * `superseded` is the one that is not: it is derived from the journal afterwards, by
 * {@link ./reconcile.reconciledDeaths}, for an arm that a later arm replaced with no terminal event in
 * between. It says "this arm ended and no live observer saw how" and deliberately claims nothing more.
 */
export type ListenerDeathReason =
  "process-dead" | "heartbeat-missing" | "heartbeat-foreign" | "heartbeat-stale" | "socket-down" | "superseded";

/** One entry in the append-only arm journal — the durable record of what the supervisor saw and did. */
export type ListenerArmEvent =
  | { readonly kind: "armed"; readonly atIso: string; readonly armId: string; readonly pid: number }
  | {
      readonly kind: "died";
      readonly atIso: string;
      readonly armId: string;
      readonly pid: number;
      readonly reason: ListenerDeathReason;
      /**
       * The tail of the dead arm's own log, captured at the moment the death was observed.
       *
       * The owner's complaint was never a missed tag — it was "an agent reporting the socket died and no one
       * knows why". Recording that it died does not answer that; keeping what it was SAYING as it went does.
       * This is evidence, deliberately not a diagnosis: nothing infers a cause from it.
       */
      readonly lastLog?: string;
      /**
       * Whether a live tick watched this death happen, or a later pass reconstructed it from durable state.
       *
       * Absent means `observed`, which is what every line written before reconciliation existed meant. The
       * distinction is the whole reason the harness reap could be recorded at all: the watcher and the
       * listener were sibling background tasks of one session, so whatever reaped one reaped the other and no
       * observer was alive at the moment there was anything to observe.
       */
      readonly discovery?: "observed" | "reconciled";
    }
  | { readonly kind: "disarmed"; readonly atIso: string; readonly armId: string; readonly pid: number }
  | { readonly kind: "escalated"; readonly atIso: string; readonly armId: string; readonly why: string };

/**
 * Parse one journal line. A line that will not decode is DROPPED rather than failing the read: this journal
 * is evidence, and one torn line written during a kill must not blind the supervisor to every other entry.
 *
 * @param line one raw JSONL line
 * @returns the decoded event, or `undefined` when the line is not one
 */
export function parseListenerArmEvent({ line }: { line: string }): ListenerArmEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const atIso = raw["atIso"];
  const armId = raw["armId"];
  if (typeof atIso !== "string" || !Number.isFinite(Date.parse(atIso)) || typeof armId !== "string") {
    return undefined;
  }
  const why = raw["why"];
  if (raw["kind"] === "escalated" && typeof why === "string") {
    return { armId, atIso, kind: "escalated", why };
  }
  return pidEventOf({ armId, atIso, raw });
}

/**
 * The three journal kinds that carry a pid — split out of {@link parseListenerArmEvent} so neither half
 * branches more than it has to.
 *
 * @param armId the already-validated arm id
 * @param atIso the already-validated timestamp
 * @param raw the decoded line
 * @returns the decoded event, or `undefined` when it is not one of these three
 */
function pidEventOf({
  armId,
  atIso,
  raw,
}: {
  armId: string;
  atIso: string;
  raw: Record<string, unknown>;
}): ListenerArmEvent | undefined {
  const pid = raw["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }
  const kind = raw["kind"];
  if (kind === "armed" || kind === "disarmed") {
    return { armId, atIso, kind, pid };
  }
  const reason = raw["reason"];
  if (kind !== "died" || !isDeathReason(reason)) {
    return undefined;
  }
  const lastLog = raw["lastLog"];
  const discovery = raw["discovery"];
  return {
    armId,
    atIso,
    kind: "died",
    pid,
    reason,
    ...(typeof lastLog === "string" ? { lastLog } : {}),
    ...(discovery === "observed" || discovery === "reconciled" ? { discovery } : {}),
  };
}

/** Whether a decoded value names one of the six death reasons. */
function isDeathReason(value: unknown): value is ListenerDeathReason {
  return (
    value === "process-dead" ||
    value === "heartbeat-missing" ||
    value === "heartbeat-foreign" ||
    value === "heartbeat-stale" ||
    value === "socket-down" ||
    value === "superseded"
  );
}

/**
 * Whether an escalation is still standing — i.e. the supervisor stopped, and nobody has done anything about
 * it since.
 *
 * This is what makes the escalation STICK. Without it, the tick after an escalation sees an unarmed home,
 * concludes "nothing is running", and hands back an arm command — so the session re-arms anyway and the
 * whole bounded-retry contract is decoration. Measured live: that is exactly what the first
 * implementation did on the very next tick.
 *
 * An `armed` event clears it, and that is the deliberate escape rather than an oversight: `listen arm` is a
 * person (or a session acting on a person's instruction) choosing to start one, and the listener journals
 * `armed` from inside itself when it does. A `disarmed` event clears it too — someone tidied up. What does
 * NOT clear it is another automatic tick, which is the whole point.
 *
 * @param events every journalled arm event, in file order
 * @returns true when the newest lifecycle event is an escalation
 */
export function escalationStanding({ events }: { events: readonly ListenerArmEvent[] }): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const kind = events[index]!.kind;
    if (kind === "escalated") {
      return true;
    }
    if (kind === "armed" || kind === "disarmed") {
      return false;
    }
  }
  return false;
}

/** What the supervisor should do about a death it just observed. */
export type RearmDecision =
  | { readonly action: "rearm"; readonly deathsInWindow: number; readonly remaining: number }
  | { readonly action: "escalate"; readonly deathsInWindow: number; readonly why: string };

/**
 * Decide whether to re-arm after a death, counting the deaths already journalled inside the window plus the
 * one just observed.
 *
 * The death being decided about is counted, not assumed to be already in `events` — the caller journals it
 * either way, and making the caller's write order decide the threshold is exactly the kind of ordering
 * dependence that produces an off-by-one nobody notices until the fourth corpse.
 *
 * @param events every journalled arm event, in any order
 * @param nowMs the instant the death was observed, epoch milliseconds
 * @param windowMs how far back deaths are counted (defaults to {@link REARM_WINDOW_MS})
 * @param maxDeaths how many deaths in that window are tolerated (defaults to {@link MAX_DEATHS_PER_WINDOW})
 * @returns re-arm, or escalate with the sentence to record for the owner
 */
export function rearmDecision({
  events,
  nowMs,
  windowMs = REARM_WINDOW_MS,
  maxDeaths = MAX_DEATHS_PER_WINDOW,
}: {
  events: readonly ListenerArmEvent[];
  nowMs: number;
  windowMs?: number;
  maxDeaths?: number;
}): RearmDecision {
  const since = nowMs - windowMs;
  const priorDeaths = events.filter(
    (event) => event.kind === "died" && Date.parse(event.atIso) >= since && Date.parse(event.atIso) <= nowMs,
  ).length;
  const deathsInWindow = priorDeaths + 1;
  if (deathsInWindow >= maxDeaths) {
    return {
      action: "escalate",
      deathsInWindow,
      why:
        `the Slack listener died ${String(deathsInWindow)} times inside ${String(Math.round(windowMs / 60_000))} ` +
        "minutes; re-arming again would be a blind retry loop, so the bot is left DOWN and this is the question " +
        "instead: what is killing it, and should it be re-armed by hand?",
    };
  }
  return { action: "rearm", deathsInWindow, remaining: maxDeaths - deathsInWindow };
}
