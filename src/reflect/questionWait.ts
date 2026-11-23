/**
 * HOW LONG a question kept work waiting on the owner's answer — the hours a LIVE run held it, from the ask to its settle.
 *
 * `./questionSettle.ts` names the event a wait runs to; this file reads the clock between. A dead session settles no
 * question, but no work waits through it either, so the clock pauses at an `orphaned` and resumes at the `started`
 * that carries the question on (`handover/openQuestion.ts`'s `inheritedQuestion`). Every rule that makes a wait
 * UNMEASURABLE lives here: an instant that will not read, a span that runs backwards, or journal lines whose instants
 * contradict their append order — the reading that understates, never the one that inflates.
 *
 * Pure: events and the window in, one measure out.
 */
import type { RunEvent } from "../handover/ledger.js";
import { settledAt, settlingEvent } from "./questionSettle.js";
import { namesAnInstant, type ReflectWindow } from "./substrate.js";

/** What one in-window question measured: how long the work it stopped sat waiting on the owner's answer. */
export interface QuestionWaitMeasure {
  readonly waitHours: number;
  /** Whether nothing had settled it by the window's end, so the wait is a floor rather than the whole wait. */
  readonly openAtWindowEnd: boolean;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Hours from one instant to another.
 *
 * @returns the span in hours, or `undefined` when either names no real instant or the span runs backwards
 */
export function hoursBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number | undefined {
  if (!namesAnInstant({ tsIso: fromIso }) || !namesAnInstant({ tsIso: toIso })) {
    return undefined;
  }
  const span = Date.parse(toIso) - Date.parse(fromIso);
  if (span < 0) {
    return undefined;
  }
  return span / MS_PER_HOUR;
}

/**
 * How long a question at `position` waited: to the first later settling event, else to the window's end.
 *
 * @param events the decoded journal, in file order
 * @param position the question's index in `events`
 * @param liveAtAsk whether a live run held the question the moment it was asked
 * @returns the measure; `undefined` when it cannot be measured; `"unheld"` when it was measured and no live run ever
 *   held it before it settled
 */
export function questionWait({
  events,
  position,
  window,
  liveAtAsk,
}: {
  events: readonly RunEvent[];
  position: number;
  window: ReflectWindow;
  liveAtAsk: boolean;
}): QuestionWaitMeasure | "unheld" | undefined {
  const asked = events[position]!.atIso;
  // A question stamped earlier than a line appended before it contradicts the journal's own order, so
  // its ask is no instant to measure from — an append race with a ruling included, which then states no wait at all.
  const stampedAfterAsk = events
    .slice(0, position)
    .some((event) => namesAnInstant({ tsIso: event.atIso }) && Date.parse(event.atIso) > Date.parse(asked));
  if (stampedAfterAsk) {
    return undefined;
  }
  const settle = settlingEvent({ events, position });
  const settleIso = settle === undefined ? undefined : settledAt({ event: settle });
  // A settle whose instant will not parse is unmeasurable, never "still open": the board's fold DID
  // settle the question there, so a wait run on to the window's end would be invented.
  if (settleIso !== undefined && !namesAnInstant({ tsIso: settleIso })) {
    return undefined;
  }
  // Instants, never strings: an offset-form timestamp sorts wrong against the window's Z-form end.
  const settledInWindow = settleIso !== undefined && Date.parse(settleIso) <= Date.parse(window.toIso);
  const stopIso = settledInWindow ? settleIso : window.toIso;
  const settleAt = settle === undefined ? events.length : events.indexOf(settle);
  // A settle appended BEFORE the ask can only be a ruling decided after it. A question stamped after that ruling's line
  // is already refused above, so this ruling was journalled before it was decided, and a ruling decided after it was
  // journalled is a clock contradiction wherever it sits: no line orders the wait, so it is unmeasurable.
  const decidedAfterJournalled =
    settle !== undefined &&
    namesAnInstant({ tsIso: settle.atIso }) &&
    Date.parse(settleIso!) > Date.parse(settle.atIso);
  if (settleAt < position || decidedAfterJournalled) {
    return undefined;
  }
  const live = liveHours({
    askedIso: asked,
    between: events.slice(position + 1, settleAt),
    journalledSettleIso: settle?.atIso,
    liveAtAsk,
    stopIso,
  });
  if (live === undefined) {
    return undefined;
  }
  if (!live.held) {
    return "unheld";
  }
  return { openAtWindowEnd: !settledInWindow, waitHours: live.hours };
}

/** The clock a wait is read off, stepped one journal line at a time. */
interface LiveClock {
  /** Hours already counted in closed live stretches. */
  readonly total: number;
  /** Whether any live run has held the question yet. */
  readonly held: boolean;
  /** Where the current live stretch began, or `undefined` while the clock is paused. */
  readonly liveFrom: string | undefined;
  /**
   * The instant the clock last paused at — the ask itself for a question asked with no run live. A re-start stamped
   * before it would open a live stretch overlapping one already counted, or one before the ask.
   */
  readonly pausedSince: string;
}

/**
 * The hours a question was held by a LIVE run, from its ask to `stopIso`. A dead session settles no question, but no
 * work waits through it either, so the clock pauses at an `orphaned`; a re-start carries the question on
 * (`openQuestion.ts`'s `inheritedQuestion`) and resumes it. A question asked while no run was live —
 * after its cycle closed — starts paused and is first held at the restart that carries it. Any instant
 * that will not read, a span that runs backwards, or any line from the ask to the moment the settle was JOURNALLED
 * stamped earlier than the line appended before it makes the whole wait unmeasurable. A ruling decided
 * before a death it was journalled after still stops the clock at its decision.
 *
 * @param journalledSettleIso the instant the settling line was journalled, when one settled it; every line before it
 *   must precede it
 * @returns the summed live hours and whether any live run held it at all, or `undefined` when they cannot be measured
 */
function liveHours({
  askedIso,
  between,
  liveAtAsk,
  journalledSettleIso,
  stopIso,
}: {
  askedIso: string;
  between: readonly RunEvent[];
  liveAtAsk: boolean;
  journalledSettleIso: string | undefined;
  stopIso: string;
}): { hours: number; held: boolean } | undefined {
  const stamped = [askedIso, ...between.map((event) => event.atIso)];
  if (journalledSettleIso !== undefined) {
    stamped.push(journalledSettleIso);
  }
  if (!runsForwards({ stamped })) {
    return undefined;
  }
  let clock: LiveClock | undefined = {
    held: liveAtAsk,
    liveFrom: liveAtAsk ? askedIso : undefined,
    pausedSince: askedIso,
    total: 0,
  };
  for (const event of between) {
    clock = stepClock({ clock, event, stopIso });
    if (clock === undefined) {
      return undefined;
    }
  }
  if (clock.liveFrom === undefined) {
    return { held: clock.held, hours: clock.total };
  }
  const span = hoursBetween({ fromIso: clock.liveFrom, toIso: stopIso });
  if (span === undefined) {
    return undefined;
  }
  return { held: clock.held, hours: clock.total + span };
}

/**
 * Whether every readable instant runs forwards in the order it was appended, whatever its
 * line's kind: a line stamped against that order is a clock the wait cannot be read off.
 */
function runsForwards({ stamped }: { stamped: readonly string[] }): boolean {
  const instants = stamped.filter((tsIso) => namesAnInstant({ tsIso })).map((tsIso) => Date.parse(tsIso));
  return instants.every((instant, index) => index === 0 || instant >= instants[index - 1]!);
}

/**
 * The clock after one journal line: an `orphaned` closes a live stretch at its own instant (clipped to the stop), a
 * `started` opens one when the clock is paused, and every other line leaves it alone.
 *
 * @returns the stepped clock, or `undefined` when the line makes the wait unmeasurable
 */
function stepClock({
  clock,
  event,
  stopIso,
}: {
  clock: LiveClock;
  event: RunEvent;
  stopIso: string;
}): LiveClock | undefined {
  if (event.kind === "orphaned" && clock.liveFrom !== undefined) {
    return pauseAt({ clock, liveFrom: clock.liveFrom, orphanIso: event.atIso, stopIso });
  }
  if (event.kind === "started" && clock.liveFrom === undefined) {
    return resumeAt({ clock, startIso: event.atIso, stopIso });
  }
  return clock;
}

/** The clock paused at an orphan: the live stretch from `liveFrom` to the orphan, or to the stop if that is sooner. */
function pauseAt({
  clock,
  liveFrom,
  orphanIso,
  stopIso,
}: {
  clock: LiveClock;
  liveFrom: string;
  orphanIso: string;
  stopIso: string;
}): LiveClock | undefined {
  if (!namesAnInstant({ tsIso: orphanIso })) {
    return undefined;
  }
  const until = Date.parse(orphanIso) < Date.parse(stopIso) ? orphanIso : stopIso;
  const span = hoursBetween({ fromIso: liveFrom, toIso: until });
  if (span === undefined) {
    return undefined;
  }
  return { held: clock.held, liveFrom: undefined, pausedSince: orphanIso, total: clock.total + span };
}

/** The clock resumed at a re-start that carries the question, unless the re-start falls at or after the stop. */
function resumeAt({
  clock,
  startIso,
  stopIso,
}: {
  clock: LiveClock;
  startIso: string;
  stopIso: string;
}): LiveClock | undefined {
  if (!namesAnInstant({ tsIso: startIso }) || Date.parse(startIso) < Date.parse(clock.pausedSince)) {
    return undefined;
  }
  if (Date.parse(startIso) >= Date.parse(stopIso)) {
    return clock;
  }
  return { ...clock, held: true, liveFrom: startIso };
}
