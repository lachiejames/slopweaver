/**
 * Reconstructing deaths NOBODY WATCHED, from the durable journal alone. Pure — no clock, no filesystem.
 *
 * ## Why a watcher cannot be the signal
 *
 * Measured three times in one day: the Claude Code harness stopped the
 * loop session's background tasks, and each time it took the LISTENER and the DEATH-WATCH WATCHING IT in the
 * same event, 7–10 ms apart. They were sibling background tasks of one session, so whatever reaped one reaped
 * the other. The loop's own words for it: *"a death-watch that shares a parent with what it watches is not a
 * watchdog."*
 *
 * That is not a defect any watcher shape fixes. `AGENTS.md` rule 2 permits Slopweaver to start a process only
 * as a child of a visible session, so every process it may legally start is in the class the reaper reaps.
 * The conclusion this module is built on: **liveness accounting must not require anything to be alive at the
 * moment there is something to observe.**
 *
 * ## So a death is derived, not witnessed
 *
 * Everything needed is already durable. The listener self-registers `armed` in `arms.jsonl` and rewrites
 * `heartbeat.json` on its own interval, both from inside its own process. So a pass run at ANY later time —
 * minutes after the death, from a different session, from a session that did not exist when it happened —
 * can reconstruct two facts a live watcher would have seen:
 *
 * - the arm on record is DOWN and nothing has journalled its end (the caller's `observed` death); and
 * - an arm was replaced by a later one with no terminal event in between, which no reader could have
 *   noticed at the time because there was no reader.
 *
 * The second is the one that closes the hole the incident opened. `arms.jsonl` held EIGHT `armed` lines and
 * ZERO deaths on the reaped day, because the only writer of a death was a tick that had itself been reaped —
 * and eight arms reading zero deaths is indistinguishable from a stable day.
 *
 * ## What a derived death refuses to claim
 *
 * {@link ListenerDeathReason}'s `superseded` means "this arm ended and no live observer saw how". It is NOT a
 * claim that the harness reaped it. Two of that day's five arm changes were deliberate operator stops for an
 * ordered re-arm onto a newer commit, and from `arms.jsonl` alone they look exactly like the three reaps —
 * the discriminator (`[killed]` versus `[exited with code 143]`) lives in the harness's own task bookkeeping,
 * which this program cannot read. So the ambiguity is fixed at the SOURCE instead: a deliberate stop runs
 * `slopweaver listen disarm` first, which journals `disarmed`, and a reconciled pass then leaves that arm
 * alone. An operator who skips it gets one arm recorded as `superseded`, which is the honest reading.
 */

import type { ListenerArmEvent, ListenerDeathReason } from "./rearm.js";

/**
 * A death the CALLER observed on the live process, for {@link reconciledDeaths} to journal if nothing has.
 *
 * `atIso` is deliberately the caller's tightest LOWER BOUND on when the process stopped — the last beat the
 * dead arm wrote, falling back to when it was armed — rather than the instant the caller noticed. The
 * escalation window is fifteen minutes and a reconciling pass may run long after the fact, so stamping
 * discovery time instead would let three deaths that happened inside one minute look like three spread over
 * an hour.
 */
export interface ObservedListenerDeath {
  readonly armId: string;
  readonly reason: ListenerDeathReason;
  readonly atIso: string;
  /** The tail of the dead arm's own log, when there was one to read. Evidence, never a diagnosis. */
  readonly lastLog?: string;
}

/** One arm seen `armed`, carried forward until a later `armed` shows what replaced it. */
interface OpenArm {
  readonly armId: string;
  readonly pid: number;
}

/**
 * Every death the journal implies but does not record — the events a caller should append, in order.
 *
 * Idempotent by construction, which is what makes this safe to run on a tick: a death already journalled
 * CLOSES its arm, so a second pass over the same journal returns nothing. Both callers rely on that — the
 * recipe scheduler ticks this every few minutes, and `listen supervise` runs it before every one of its own
 * ticks.
 *
 * An `escalated` event deliberately does not close an arm. `listen supervise` writes `died` and then
 * `escalated` for the same arm, so treating an escalation as terminal would make the ordering of those two
 * writes decide whether a death gets counted twice.
 *
 * The journal is read in FILE order for SUCCESSION (which arm replaced which) but scanned WHOLE for
 * TERMINATION (which arms already have a death or a disarm on record). Those two cannot be the same pass:
 * every death this function returns is appended AFTER the `armed` lines it is derived from, so an arm closed
 * by a previous reconciliation is closed by a line that sits at the end of the file, nowhere near its arm.
 *
 * @param events every journalled arm event, in FILE order — the order matters here, unlike in
 *   {@link ./rearm.rearmDecision}, because an arm is closed by what was written after it
 * @param observed the death the caller saw on the live process just now, or `undefined` when it saw none
 * @returns the `died` events to append, oldest first; empty when the journal already accounts for everything
 */
export function reconciledDeaths({
  events,
  observed,
}: {
  events: readonly ListenerArmEvent[];
  observed: ObservedListenerDeath | undefined;
}): readonly ListenerArmEvent[] {
  // Whether an arm is CLOSED is decided by a whole-file scan, never by what follows it in file order. A
  // reconciled death is appended to the end of a journal whose `armed` lines are all older than it, so an
  // adjacency walk never sees it and re-emits the same death on every pass — measured, on the first live run
  // against the real reaped-day journal, which grew from 7 back-written deaths to 14 on the second tick.
  const terminated = new Set(
    events.filter((event) => event.kind === "died" || event.kind === "disarmed").map((event) => event.armId),
  );
  const deaths: ListenerArmEvent[] = [];
  let open: OpenArm | undefined;
  for (const event of events) {
    if (event.kind !== "armed") {
      continue;
    }
    if (open !== undefined && open.armId !== event.armId && !terminated.has(open.armId)) {
      terminated.add(open.armId);
      deaths.push({
        armId: open.armId,
        atIso: event.atIso,
        discovery: "reconciled",
        kind: "died",
        pid: open.pid,
        reason: "superseded",
      });
    }
    open = { armId: event.armId, pid: event.pid };
  }
  if (observed === undefined || open === undefined || open.armId !== observed.armId || terminated.has(open.armId)) {
    return deaths;
  }
  deaths.push({
    armId: open.armId,
    atIso: observed.atIso,
    discovery: "reconciled",
    kind: "died",
    pid: open.pid,
    reason: observed.reason,
    ...(observed.lastLog === undefined ? {} : { lastLog: observed.lastLog }),
  });
  return deaths;
}

/**
 * The tightest LOWER BOUND a caller can put on when the current arm stopped.
 *
 * The last beat that arm wrote is the newest instant it is known to have been alive, so it is the honest
 * stamp for a death discovered later; when it never beat, the moment it was armed is all there is. Clamped to
 * `nowMs` because a beat stamped in the future (clock skew across a suspend, which
 * {@link ./heartbeat.heartbeatAgeMs} already tolerates) must not push a death outside the window that is
 * about to count it.
 *
 * @param armStartedAtIso when the arm being judged was started, ISO-8601
 * @param lastBeatAtIso when that SAME arm last wrote a beat, or `undefined` when it never did or the newest
 *   beat on disk belongs to another arm
 * @param nowMs the current instant, epoch milliseconds
 * @returns the ISO-8601 instant to stamp the death with
 */
export function deathLowerBoundIso({
  armStartedAtIso,
  lastBeatAtIso,
  nowMs,
}: {
  armStartedAtIso: string;
  lastBeatAtIso: string | undefined;
  nowMs: number;
}): string {
  if (lastBeatAtIso === undefined) {
    // It never beat, or the newest beat on disk is another arm's: the moment it was armed is all there is.
    return new Date(Math.min(Date.parse(armStartedAtIso), nowMs)).toISOString();
  }
  return new Date(Math.min(Date.parse(lastBeatAtIso), nowMs)).toISOString();
}
