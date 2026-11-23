/**
 * WHERE a question stopped being held — the event that settled it, read off the board's own fold.
 *
 * `./questionWait.ts` measures how long work sat waiting on the owner's answer; this file names the event that wait runs
 * to. It is a separate seam because every rule here is about WHICH line settles, never about the clock between:
 * an answer, a withdrawal naming the held text, a correction or a reshape behave exactly as `handover/
 * openQuestion.ts`'s `openQuestionAfter` folds them, and a ruling the owner made at or after the ask settles it at its
 * DECISION instant, as `handover/ownerWait.ts`'s `already-ruled` reads it.
 *
 * Pure: events in, one event out.
 */
import type { RunEvent } from "../handover/ledger.js";
import { openQuestionAfter } from "../handover/openQuestion.js";
import { namesAnInstant } from "./substrate.js";

/** The kinds that end a cycle's work. `released` is a seat handing ownership on, not an ending. */
export const CYCLE_END_KINDS = new Set<RunEvent["kind"]>(["abandoned", "closed", "finished"]);

/**
 * The first event after `position` that stops the question asked there being held — read off the board's OWN fold.
 *
 * No second copy of the rule: each step is `handover/openQuestion.ts`'s `openQuestionAfter`, the fold a card reads,
 * so an answer, a withdrawal naming the held text, a correction or a reshape behave here exactly as there (a hand-written copy once
 * disagreed on a reshape of an already-shaped ask). A NEW question replaces the
 * held one in that fold, so this wait stops there rather than overlapping the next one's — every `question` line,
 * a byte-identical one included, since the fold carries no duplicate marker that would make it anything else, so it is never read as one ask appended twice. The cycle's work ending
 * settles it too, as `inheritedQuestion`'s carry holds.
 *
 * @param events the decoded journal, in file order
 * @param position the question's index in `events`
 * @returns the settling event, or `undefined` when the question is still held at the journal's end
 */
export function settlingEvent({
  events,
  position,
}: {
  events: readonly RunEvent[];
  position: number;
}): RunEvent | undefined {
  const askedIso = events[position]!.atIso;
  let open = openQuestionAfter({ event: events[position]!, open: undefined });
  // A ruling the owner made at or after the ask answered it, as `ownerWait.ts`'s `already-ruled` reads it —
  // unless a later line restates the question: a ruling before the restatement was what it was restated
  // FROM, so only one journalled after the latest restatement answers (`heldQuestion.ts`, `rulingsAfterRestatement`).
  // Append order is not the clock: a ruling that won the append race sits BEFORE the question in the
  // file yet was decided after it was asked, and `ownerWait.ts` reads it as answering regardless of position. Only a
  // readable decision instant counts from that side, so an old garbled ruling never settles every later question.
  let answeringRuling: RunEvent | undefined = earliestRulingDecidedAfter({
    askedIso,
    candidates: events.slice(0, position),
  });
  for (const [offset, event] of events.slice(position + 1).entries()) {
    const after = position + 1 + offset;
    // A re-start is NOT a settle: `openQuestion.ts`'s `inheritedQuestion` carries a held question into
    // the next cycle, so the wait runs on through a `started` to whatever settles it there.
    const endsTheAsk = CYCLE_END_KINDS.has(event.kind) || event.kind === "question";
    if (!endsTheAsk) {
      answeringRuling = earlierAnswer({ askedIso, current: answeringRuling, event });
    }
    const restatedBefore = open?.restatedBy;
    open = endsTheAsk ? undefined : openQuestionAfter({ event, open });
    if (open === undefined) {
      return backfilledFirst({
        after,
        askedIso,
        events,
        settle: firstSettle({ ruling: answeringRuling, settle: event }),
      });
    }
    if (open.restatedBy !== restatedBefore) {
      answeringRuling = undefined;
    }
  }
  return answeringRuling;
}

/**
 * The answering ruling to carry on with after `event`: `event` itself when it is a ruling that answers the ask and
 * was decided before the one already held, else the one already held.
 */
function earlierAnswer({
  askedIso,
  current,
  event,
}: {
  askedIso: string;
  current: RunEvent | undefined;
  event: RunEvent;
}): RunEvent | undefined {
  if (event.kind !== "ruling" || !rulingAnswers({ askedIso, ruling: event })) {
    return current;
  }
  if (current === undefined || decidedBefore({ first: event, second: current })) {
    return event;
  }
  return current;
}

/**
 * The settle, unless a ruling BACKFILLED after it was decided before it and at or after the ask: the owner had
 * answered by then, so the work waited on a session from that instant, not on them (`ownerWait.ts`'s `already-ruled`).
 * Both instants must read; the earliest such ruling wins.
 *
 * @param after the settle's position; only rulings appended after it are backfills
 * @returns the backfilled ruling that answered first, else `settle`
 */
function backfilledFirst({
  after,
  askedIso,
  events,
  settle,
}: {
  after: number;
  askedIso: string;
  events: readonly RunEvent[];
  settle: RunEvent;
}): RunEvent {
  const settleIso = settledAt({ event: settle });
  if (!namesAnInstant({ tsIso: settleIso })) {
    return settle;
  }
  const backfill = earliestRulingDecidedAfter({ askedIso, candidates: events.slice(after + 1) });
  if (backfill === undefined || !decidedBefore({ first: backfill, second: settle })) {
    return settle;
  }
  return backfill;
}

/**
 * Of the rulings appended before a question, the one decided earliest at or after it was asked — both instants
 * readable — or `undefined` when none answers it.
 */
function earliestRulingDecidedAfter({
  askedIso,
  candidates,
}: {
  askedIso: string;
  candidates: readonly RunEvent[];
}): RunEvent | undefined {
  if (!namesAnInstant({ tsIso: askedIso })) {
    return undefined;
  }
  const asked = Date.parse(askedIso);
  let earliest: { event: RunEvent; decided: number } | undefined;
  for (const event of candidates) {
    const decidedIso = settledAt({ event });
    const readable = event.kind === "ruling" && namesAnInstant({ tsIso: decidedIso });
    const decided = Date.parse(decidedIso);
    if (readable && decided >= asked && (earliest === undefined || decided < earliest.decided)) {
      earliest = { decided, event };
    }
  }
  return earliest?.event;
}

/**
 * Which of an answering ruling and the event that closed the scan settled the question FIRST: an
 * answer journalled after a ruling appended earlier but decided later is the real settle. Where either instant will
 * not read, that one is returned: it proves the question settled but not when, so the wait reads as
 * unmeasurable rather than measured to the other.
 */
function firstSettle({ ruling, settle }: { ruling: RunEvent | undefined; settle: RunEvent }): RunEvent {
  if (ruling === undefined) {
    return settle;
  }
  if (!namesAnInstant({ tsIso: settledAt({ event: settle }) })) {
    return settle;
  }
  if (decidedBefore({ first: settle, second: ruling })) {
    return settle;
  }
  return ruling;
}

/** Whether `first` was decided strictly before `second`; an unreadable instant on either side is never "before". */
function decidedBefore({ first, second }: { first: RunEvent; second: RunEvent }): boolean {
  const firstIso = settledAt({ event: first });
  const secondIso = settledAt({ event: second });
  if (!namesAnInstant({ tsIso: firstIso }) || !namesAnInstant({ tsIso: secondIso })) {
    return false;
  }
  return Date.parse(firstIso) < Date.parse(secondIso);
}

/**
 * When an event settled a question: a ruling at its DECISION instant (a backfill writes its line later), else its own.
 *
 * @returns the instant the event settled a question at, as written
 */
export function settledAt({ event }: { event: RunEvent }): string {
  if (event.kind === "ruling" && event.decidedIso !== undefined) {
    return event.decidedIso;
  }
  return event.atIso;
}

/**
 * Whether a ruling answers a question asked at `askedIso`: decided at or after it. A decision instant that will not
 * parse still settles it, so the wait reads as unmeasurable rather than running on past an answer.
 */
function rulingAnswers({ askedIso, ruling }: { askedIso: string; ruling: RunEvent }): boolean {
  const decided = settledAt({ event: ruling });
  if (!namesAnInstant({ tsIso: decided }) || !namesAnInstant({ tsIso: askedIso })) {
    return true;
  }
  return Date.parse(decided) >= Date.parse(askedIso);
}
