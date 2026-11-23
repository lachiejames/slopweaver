/**
 * What a run-journal finding MEASURABLY cost — the consequence a self-improvement card opens on.
 *
 * A card that read "a brief was amended eleven times" could be really bad or fine, so it has to lead with the
 * impact: the briefing reached the owner five times slower than it should have. So an amendment finding says
 * how long the rewritten runs took against the untouched ones and how many were dropped, and a question
 * finding says how long work sat waiting on the owner's answer. Nothing else in a journal measures a cost to the
 * owner.
 *
 * This file measures per CYCLE; a question's wait is `./questionWait.ts`, the event it waits to `./questionSettle.ts`,
 * and the sentences every measure becomes `./journalConsequenceText.ts`.
 *
 * ## What these numbers are, and what they are not
 *
 * **Per run CYCLE, not per journal file.** A journal holds every cycle a row ever had — each `started` opens a
 * new one — so joining an amendment to "the run" by file would charge one cycle's rewrite to another's
 * duration. Eleven amendments to one cycle are eleven occurrences and ONE duration observation. A cycle no
 * `started` opened is no run at all: nothing in it was rewritten, dropped or held a question.
 *
 * **An association, never a cause.** Bigger work is both rewritten more and slower, so the amendment line
 * says "a link, not a measured slowdown" in its own words, carries both cohort sizes, and states nothing at
 * all when the rewritten runs were no slower — a finding with no cost is not a card.
 *
 * **Tokens are not here.** No ledger keys token spend to a run slug: a session's transcript can span several
 * rows, and locating one is a directory scan this pure pass does not make. An honest "tokens burned" line needs an attribution model first.
 *
 * `released` is excluded throughout: it hands a seat's ownership on and is not the work ending.
 *
 * Pure: events and the window in, measurements out.
 */
import type { RunEvent } from "../handover/ledger.js";
import { CYCLE_END_KINDS } from "./questionSettle.js";
import { hoursBetween, type QuestionWaitMeasure, questionWait } from "./questionWait.js";
import { inWindow, namesAnInstant, type ReflectWindow } from "./substrate.js";

/** What one in-window amendment measured about the cycle it rewrote. */
export interface AmendmentMeasure {
  /** `<slug>#<cycle index>`, so a cycle rewritten eleven times counts once in a median. */
  readonly cycleId: string;
  /** Start to finish, when the cycle finished or closed inside the window; otherwise `undefined`. */
  readonly completedHours: number | undefined;
  /** Whether the cycle was abandoned inside the window — dropped, unfinished. */
  readonly abandoned: boolean;
}

/** One cycle that finished inside the window, for the cohort an amended cycle is compared against. */
export interface CompletedCycle {
  readonly cycleId: string;
  readonly amended: boolean;
  readonly elapsedHours: number;
}

/** The cycle an `abandoned` event ended — the unit a dropped-work count is in. */
export interface AbandonedEndMeasure {
  readonly cycleId: string;
}

/** Everything one journal measured, keyed back to the event positions the collector sights. */
export interface JournalMeasures {
  /** Keyed by the amendment's position in the journal's event list. */
  readonly amendments: ReadonlyMap<number, AmendmentMeasure>;
  /** Keyed by the question's position in the journal's event list. */
  readonly questions: ReadonlyMap<number, QuestionWaitMeasure>;
  /**
   * Keyed by the position of the `abandoned` event that ENDED its cycle in the window — the cycle's first ending
   * only, so a second `abandoned` line in the same cycle is never a second dropped run.
   */
  readonly abandonedEnds: ReadonlyMap<number, AbandonedEndMeasure>;
  readonly completed: readonly CompletedCycle[];
  /** Cycles or waits whose timestamps would not parse or ran backwards, so they are in no number. */
  readonly unmeasurable: number;
}

/**
 * The kinds that close a cycle in the ledger's phase fold: the work-ending kinds plus `orphaned`, a session dying.
 * An orphan ends its cycle — a later line is not that cycle's ending — but it neither finished the
 * work nor dropped it, and it settles no question (`openQuestion.ts` carries one through it).
 */
const CYCLE_CLOSE_KINDS = new Set<RunEvent["kind"]>([...CYCLE_END_KINDS, "orphaned"]);

/** One journal line and where it sits in the file. */
interface Placed {
  readonly event: RunEvent;
  readonly position: number;
}

/** One cycle, read once: its lines, the `started` that opened it, and the line that closed it. */
interface CycleView {
  readonly cycleId: string;
  readonly inCycle: readonly Placed[];
  readonly start: RunEvent | undefined;
  readonly ending: Placed | undefined;
}

/** The maps one journal's measures accumulate into, before the unmeasurable count is attached. */
interface MeasureSink {
  readonly amendments: Map<number, AmendmentMeasure>;
  readonly questions: Map<number, QuestionWaitMeasure>;
  readonly abandonedEnds: Map<number, AbandonedEndMeasure>;
  readonly completed: CompletedCycle[];
}

/**
 * Whether an instant sits inside its run: a parseable instant at or after the start and at or before the end,
 * each bound checked only where the run records one, and a recorded bound that will not parse never satisfied.
 */
function withinRun({
  tsIso,
  startIso,
  endIso,
}: {
  tsIso: string;
  startIso: string | undefined;
  endIso: string | undefined;
}): boolean {
  if (!namesAnInstant({ tsIso })) {
    return false;
  }
  const at = Date.parse(tsIso);
  // A bound recorded at an unreadable instant bounds nothing provably, so it fails rather than passes.
  const afterStart = startIso === undefined || (namesAnInstant({ tsIso: startIso }) && at >= Date.parse(startIso));
  const beforeEnd = endIso === undefined || (namesAnInstant({ tsIso: endIso }) && at <= Date.parse(endIso));
  return afterStart && beforeEnd;
}

/** One cycle's event positions: every `started` opens one, and anything before the first is cycle 0. */
function cyclePositions({ events }: { events: readonly RunEvent[] }): readonly (readonly number[])[] {
  const cycles: number[][] = [[]];
  for (const [position, event] of events.entries()) {
    if (event.kind === "started" && cycles.at(-1)!.length > 0) {
      cycles.push([]);
    }
    cycles.at(-1)!.push(position);
  }
  return cycles;
}

/** The cycle at `positions`, read into its lines, its start and its ending. */
function viewCycle({
  cycleId,
  events,
  positions,
}: {
  cycleId: string;
  events: readonly RunEvent[];
  positions: readonly number[];
}): CycleView {
  const inCycle = positions.map((position) => ({ event: events[position]!, position }));
  return {
    cycleId,
    ending: inCycle.find(({ event }) => CYCLE_CLOSE_KINDS.has(event.kind)),
    inCycle,
    start: inCycle.find(({ event }) => event.kind === "started")?.event,
  };
}

/**
 * Measure one journal: per cycle, whether it was rewritten in the window and how it ended; per question, how
 * long it waited.
 *
 * @param slug the row the journal belongs to, which every cycle id carries
 * @param events the decoded journal, in file order
 * @param window the run's bounds
 * @returns the measurements, keyed by event position, and the count of what could not be measured
 */
export function measureJournal({
  slug,
  events,
  window,
}: {
  slug: string;
  events: readonly RunEvent[];
  window: ReflectWindow;
}): JournalMeasures {
  const sink: MeasureSink = { abandonedEnds: new Map(), amendments: new Map(), completed: [], questions: new Map() };
  let unmeasurable = 0;
  for (const [index, positions] of cyclePositions({ events }).entries()) {
    const cycle = viewCycle({ cycleId: `${slug}#${String(index)}`, events, positions });
    unmeasurable += measureCycleWork({ cycle, sink, window });
    unmeasurable += measureCycleQuestions({ cycle, events, questions: sink.questions, window });
  }
  return { ...sink, unmeasurable };
}

/**
 * One cycle's rewrites, completion and abandonment, written into `sink`.
 *
 * @returns how many of its lines could not be measured
 */
function measureCycleWork({
  cycle,
  sink,
  window,
}: {
  cycle: CycleView;
  sink: MeasureSink;
  window: ReflectWindow;
}): number {
  const { cycleId, ending, start } = cycle;
  const end = ending?.event;
  const endedInWindow = end !== undefined && inWindow({ tsIso: end.atIso, window });
  const finishedInWindow = endedInWindow && (end.kind === "closed" || end.kind === "finished");
  const completedHours =
    finishedInWindow && start !== undefined ? hoursBetween({ fromIso: start.atIso, toIso: end.atIso }) : undefined;
  let unmeasurable = finishedInWindow && start !== undefined && completedHours === undefined ? 1 : 0;
  const { appendedMidRun, midRun } = midRunAmendments({ cycle });
  unmeasurable += appendedMidRun.length - midRun.length;
  if (completedHours !== undefined) {
    // A cycle is in the "left alone" cohort only if it was NEVER rewritten, before the window included: one
    // rewritten the day before and closed today is no baseline.
    // An amendment out of clock order is no measured rewrite, but its run is no clean baseline either.
    sink.completed.push({ amended: appendedMidRun.length > 0, cycleId, elapsedHours: completedHours });
  }
  // An abandonment in a cycle no `started` opened ended no run the journal records, so it dropped none.
  const abandoned = endedInWindow && end.kind === "abandoned" && !shippedLater({ cycle }) && start !== undefined;
  if (abandoned) {
    sink.abandonedEnds.set(ending!.position, { cycleId });
  }
  for (const { position } of midRun.filter(({ event }) => inWindow({ tsIso: event.atIso, window }))) {
    sink.amendments.set(position, { abandoned, completedHours, cycleId });
  }
  return unmeasurable;
}

/**
 * A cycle's amendments appended before its ending, and of those the ones whose own instant sits inside its run.
 *
 * Only an amendment BEFORE the cycle's ending rewrote a live run; one appended after it ended rewrote nothing that
 * ran. Append order is not the clock: an amendment whose own instant falls outside its
 * run's start and end rewrote nothing provably mid-run. A cycle no `started` opened has no mid-run at all.
 */
function midRunAmendments({ cycle }: { cycle: CycleView }): {
  appendedMidRun: readonly Placed[];
  midRun: readonly Placed[];
} {
  const { ending, inCycle, start } = cycle;
  const appendedMidRun = inCycle.filter(
    ({ event, position }) => event.kind === "amended" && (ending === undefined || position < ending.position),
  );
  if (start === undefined) {
    return { appendedMidRun, midRun: [] };
  }
  const midRun = appendedMidRun.filter(({ event }) =>
    withinRun({ endIso: ending?.event.atIso, startIso: start.atIso, tsIso: event.atIso }),
  );
  return { appendedMidRun, midRun };
}

/**
 * Whether a `closed` or `finished` appended after the cycle's ending records the work shipping after all,
 * so an abandonment dropped nothing the journal can show.
 */
function shippedLater({ cycle }: { cycle: CycleView }): boolean {
  const { ending, inCycle } = cycle;
  if (ending === undefined) {
    return false;
  }
  return inCycle.some(
    ({ event, position }) => position > ending.position && (event.kind === "closed" || event.kind === "finished"),
  );
}

/**
 * Every in-window question line in one cycle, its wait written into `questions`.
 *
 * Every question line is one the board's fold holds, one appended after the cycle closed included: an orphan or a
 * re-start carries it on. A question asked after its cycle closed held up no work that cycle was doing,
 * so its wait starts paused and counts only once a re-start carries it into a live run.
 *
 * @returns how many in-window questions could not be measured
 */
function measureCycleQuestions({
  cycle,
  events,
  questions,
  window,
}: {
  cycle: CycleView;
  events: readonly RunEvent[];
  questions: Map<number, QuestionWaitMeasure>;
  window: ReflectWindow;
}): number {
  let unmeasurable = 0;
  const asked = cycle.inCycle.filter(
    ({ event }) => event.kind === "question" && inWindow({ tsIso: event.atIso, window }),
  );
  for (const placed of asked) {
    const wait = cycleQuestionWait({ cycle, events, placed, window });
    if (wait === undefined) {
      unmeasurable += 1;
    } else if (wait !== "unheld") {
      questions.set(placed.position, wait);
    }
  }
  return unmeasurable;
}

/**
 * One question's wait, once it is placed inside the run that held it.
 *
 * Append order is not the clock here either: a question whose own instant falls outside its run held
 * up no measured stretch of that run, so its wait is unmeasurable rather than measured from before it. A question in
 * a cycle no `started` opened was held by no run at all, and `inheritedQuestion` carries it into none.
 */
function cycleQuestionWait({
  cycle,
  events,
  placed,
  window,
}: {
  cycle: CycleView;
  events: readonly RunEvent[];
  placed: Placed;
  window: ReflectWindow;
}): QuestionWaitMeasure | "unheld" | undefined {
  const { ending, start } = cycle;
  if (start === undefined) {
    return undefined;
  }
  const closedBeforeAsk = ending !== undefined && ending.position < placed.position;
  const liveAtAsk = !closedBeforeAsk;
  // A question asked after its cycle closed is bounded below by that close, and by nothing above it.
  let bounds: { endIso: string | undefined; startIso: string } = { endIso: ending?.event.atIso, startIso: start.atIso };
  if (ending !== undefined && closedBeforeAsk) {
    bounds = { endIso: undefined, startIso: ending.event.atIso };
  }
  if (!withinRun({ ...bounds, tsIso: placed.event.atIso })) {
    return undefined;
  }
  return questionWait({ events, liveAtAsk, position: placed.position, window });
}
