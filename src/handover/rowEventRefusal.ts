/**
 * Why `./rowEvent.ts`'s one write path refuses an event — the transition rules over the journal as read, and the
 * evidence a ruling, a tag, a reshape or a park clear is judged against. Split from `./rowEvent.ts` (the
 * file-size ratchet) along that seam: everything here is a pure judgement over one read, and nothing here writes.
 */

import { unboundReshape } from "./heldQuestion.js";
import { currentCycle, type RunEvent, type RunState, runStateOf } from "./ledger.js";
import { strayParkClearReason, straySuspendReason } from "./parked.js";
import { type RowWriteError, RowWriteErrors } from "./rowEventErrors.js";
import { rulingAppendProblem } from "./ruling.js";
import { staleHolderReason } from "./staleHolder.js";

/** The three terminals of a run CYCLE. A cycle that reached one cannot reach another without restarting. */
const CYCLE_TERMINALS: ReadonlySet<RunEvent["kind"]> = new Set(["finished", "abandoned", "orphaned"]);

/**
 * Whether the register forbids this event following what it already says.
 *
 * Deliberately narrow. Only two rules are enforced, and both were named in the design because both are
 * transitions that make the register describe a world that never existed:
 *
 * - **A second terminal on one cycle.** `abandoned` after `finished` says one cycle both completed and was
 *   given up on, and the pair cannot both be true of it. A new cycle is how a re-run says otherwise, and
 *   `started` is deliberately not refused here for exactly that reason.
 * - **A second `closed`, anywhere in the journal.** `closed` is the ROW's terminal, not a cycle's — the work
 *   shipped once — so it is looked for across the whole journal rather than the current cycle, and it may
 *   legitimately FOLLOW a `finished` one: `finish` closes a run before a pull request merges, and `close`
 *   records that it did. Scoping it to a cycle would have refused exactly that ordinary sequence.
 * - **`answered` with no open question.** An answer to nothing reopens a run that nobody paused, which is how
 *   a closed cycle silently becomes active again. A `question-reconfirmed` or `question-withdrawn` naming any
 *   question but the open one is refused for the same reason.
 * - **`park-cleared` naming any position but the standing park.** It would clear nothing, or a park since
 *   replaced, and read as though a wake had been retired. A `park-wake-suspended` the same, or naming any question
 *   but the open one — it would hold a wake that has work to wake for.
 *
 * Everything else a verb wants to refuse — an already-settled ask, a claim over a live holder, a finish with
 * failing probes — is a VERB-level judgement that needs the doc, the repository or the session registry, none
 * of which this function has. Duplicating those here would put a second, weaker copy of each rule in the one
 * place that cannot see what they are about.
 *
 * @param event the event about to be written
 * @param state the run state derived from the journal as it stands
 * @param cycle the current cycle's events, which is where a terminal is looked for
 * @returns the refusal, or `undefined` when the transition is allowed
 */
function forbiddenTransition({
  event,
  state,
  cycle,
  events,
}: {
  event: RunEvent;
  state: RunState;
  cycle: readonly RunEvent[];
  events: readonly RunEvent[];
}): RowWriteError | undefined {
  if (event.kind === "closed") {
    const shipped = events.find((earlier) => earlier.kind === "closed");
    if (shipped !== undefined) {
      return RowWriteErrors.forbiddenTransition({
        kind: event.kind,
        phase: state.phase,
        why: `this row already recorded that it shipped at ${shipped.atIso}; work cannot ship twice`,
      });
    }
  }
  if (CYCLE_TERMINALS.has(event.kind)) {
    const already = cycle.find((earlier) => CYCLE_TERMINALS.has(earlier.kind));
    if (already !== undefined) {
      return RowWriteErrors.forbiddenTransition({
        kind: event.kind,
        phase: state.phase,
        why: `this cycle already ended "${already.kind}" at ${already.atIso}; start a new run rather than recording a second ending`,
      });
    }
  }
  // Each answers only for its own kind, so the event's kind picks which one speaks.
  const strayClear =
    event.kind === "park-wake-suspended"
      ? straySuspendReason({ event, events })
      : strayParkClearReason({ event, events });
  if (strayClear !== undefined) {
    return RowWriteErrors.forbiddenTransition({ kind: event.kind, phase: state.phase, why: strayClear });
  }
  if (event.kind === "answered" && state.openQuestion === undefined) {
    return RowWriteErrors.forbiddenTransition({
      kind: event.kind,
      phase: state.phase,
      why: "no question is open, so there is nothing this answers",
    });
  }
  const unbound = unboundQuestionRefusal({ event, state });
  if (unbound !== undefined) {
    return unbound;
  }
  const stale = staleHolderReason({ cycle, event, events });
  if (stale !== undefined) {
    return RowWriteErrors.forbiddenTransition({ kind: event.kind, phase: state.phase, why: stale });
  }
  return unboundReshape({ event, events, state });
}

/** What a text-bound question event would do to a question nobody is waiting on — the verb it names it by. */
const BINDS_BY_TEXT: ReadonlyMap<RunEvent["kind"], string> = new Map([
  // A reconfirm would say "still stands" over nothing.
  ["question-reconfirmed", "re-confirms"],
  // A withdrawal would reopen a run over nothing.
  ["question-withdrawn", "withdraws"],
  // Examples would illustrate a question nobody is waiting on.
  ["question-examples", "illustrates"],
  // A picture would show a question nobody is waiting on.
  ["question-shot", "pictures"],
]);

/**
 * The refusal for a text-bound question event naming any question but the open one, or `undefined`.
 *
 * @param event the event about to be written
 * @param state the run state derived from the journal as it stands
 * @returns the refusal, or `undefined` when the event names the open question or binds by no text
 */
function unboundQuestionRefusal({ event, state }: { event: RunEvent; state: RunState }): RowWriteError | undefined {
  const verb = BINDS_BY_TEXT.get(event.kind);
  if (verb === undefined || !("question" in event) || state.openQuestion === event.question) {
    return undefined;
  }
  return RowWriteErrors.forbiddenTransition({
    kind: event.kind,
    phase: state.phase,
    why: `the question it names is not the one open, so there is nothing this ${verb}`,
  });
}

/**
 * Whether a ruling is the owner's word arriving NOW rather than a reconstruction of one from this journal.
 *
 * A live ruling is appended over undecodable lines, and the write names what it skipped. Refusing instead has
 * the wrong failure direction twice over. MEASURED: one line of a kind this build had
 * no case for made `handover gate release` exit 1 on a gate `handover gate list` still printed as in force.
 * MEASURED: a `parked` line written by an unmerged branch made `handover rule` refuse the owner's read of a
 * briefing on the row they were looking at, from a chair whose checkout predated that kind, so their
 * words went onto a fresh row instead. Both are reachable with no hand edit — every checkout shares one home,
 * and a line an older decoder has no case for is `unreadable` to it (`./ledger.ts` § "A word this build has
 * never heard"). Repro: `echo '{"kind":"some-future-kind","atIso":"<iso>"}' >> $SLOPWEAVER_HOME/runs/<row>.jsonl`,
 * then `slopweaver handover rule <row> --anchor <a> --words <w>`.
 *
 * What a live ruling claims about this journal is only "the owner has not already said exactly this", and the worst
 * a skipped line can hide is that duplicate: a redundant line `./ruling.ts` already reads latest-by-decision.
 * The worst outcome of refusing is the owner's word recorded somewhere they were not looking, or not at all.
 *
 * A RECONSTRUCTION (`backfilledFrom`) is still refused: it claims the answer it rebuilds from sits on this row
 * and says exactly that, and an unread line may be that answer or a reconstruction of it already.
 * `./ruling.ts`'s duplicate and source checks still run, over what is readable.
 */
function isLiveRuling({ event }: { event: Extract<RunEvent, { kind: "ruling" }> }): boolean {
  return event.backfilledFrom === undefined;
}

/**
 * Why an event whose guard reads the journal's own CONTENTS cannot be appended, or `undefined` when it can.
 *
 * A ruling's guard is about EVIDENCE, not about a phase, which is why it sits beside the transition check rather
 * than inside it: `forbiddenTransition` has the run's state and nothing else, and every question a ruling has to
 * answer — is this decision already recorded, does the answer it claims to come from exist on this row and say
 * exactly that — is answered from the journal's own contents. A tag is judged against what the row already holds,
 * and a line nothing can read may be a tag. The verb has already refused that under its lock; refusing here too
 * keeps every OTHER caller of this door to the same rule.
 *
 * @param events the decoded journal the evidence is judged against
 * @param unreadable the line numbers that read could not decode
 * @returns the typed refusal, or `undefined` when the event may be appended
 */
export function evidenceRefusal({
  event,
  events,
  unreadable,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
  unreadable: readonly number[];
}): RowWriteError | undefined {
  // A reshape binds only to a question carrying no shape and no draft, and an undecodable line may be either.
  // A clear retires a park for good and names it by its position among DECODED events, so a line this build
  // cannot read may re-open the row, or shift that position for a reader that can.
  // A wake suspension is bound the same way, and to a question an undecodable line may already have answered.
  const guarded =
    event.kind === "tagged" ||
    event.kind === "question-shaped" ||
    event.kind === "park-cleared" ||
    event.kind === "park-wake-suspended";
  if (guarded && unreadable.length > 0) {
    return RowWriteErrors.journalIncomplete({ recording: event.kind, unreadableLines: unreadable });
  }
  if (event.kind !== "ruling") {
    return undefined;
  }
  if (unreadable.length > 0 && !isLiveRuling({ event })) {
    return RowWriteErrors.journalIncomplete({ recording: "ruling", unreadableLines: unreadable });
  }
  const problem = rulingAppendProblem({ event, events });
  if (problem !== undefined) {
    return RowWriteErrors.rulingIntegrityFailed({ cause: problem });
  }
  return undefined;
}

/**
 * Whether the journal as read refuses this event as a TRANSITION — the cycle's own phase rules, then the caller's
 * precondition, both judged over the same read.
 *
 * @param events the decoded journal the transition is judged over
 * @param unreadable the line numbers that read could not decode
 * @param precondition the caller's own refusal, as `applyRowEvent` takes it
 * @returns the typed refusal, or `undefined` when the transition stands
 */
export function transitionRefusal({
  event,
  events,
  precondition,
  unreadable,
}: {
  event: RunEvent;
  events: readonly RunEvent[];
  precondition:
    ((args: { events: readonly RunEvent[]; unreadable: readonly number[] }) => string | undefined) | undefined;
  unreadable: readonly number[];
}): RowWriteError | undefined {
  // An ENDING decided over a journal with undecodable lines is decided over a guess: the lines that did parse
  // cannot say what the ones that did not contained, and one of them could be the very ending this would
  // duplicate or the claim it would close over. Only `orphaned` is refused here, because it is the one event
  // whose guard compares a remembered writer, count and last event against what this read can see.
  if (event.kind === "orphaned" && unreadable.length > 0) {
    return RowWriteErrors.forbiddenTransition({
      kind: event.kind,
      phase: runStateOf({ events }).phase,
      why: `the journal has undecodable line(s) ${unreadable.join(", ")}, so what this ending claims about the cycle cannot be checked`,
    });
  }
  const refusal = forbiddenTransition({
    cycle: currentCycle({ events }),
    event,
    events,
    state: runStateOf({ events }),
  });
  if (refusal !== undefined) {
    return refusal;
  }
  const callerRefusal = precondition?.({ events, unreadable });
  if (callerRefusal !== undefined) {
    return RowWriteErrors.forbiddenTransition({
      kind: event.kind,
      phase: runStateOf({ events }).phase,
      why: callerRefusal,
    });
  }
  return undefined;
}
