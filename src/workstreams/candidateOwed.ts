/**
 * Which of the Workstreams seat's lists an answered candidate belongs on: a register entry its word owes, a
 * definition its tile does not say yet, a placing note that did not land, or a yes since replaced. Judged on the
 * register as it stands, so re-recording the same word repairs what it owed.
 *
 * Pure.
 */
import type { Candidate, Reaction } from "./candidates.js";
import { type DefinitionRow, definitionApplied } from "./definitions.js";
import { notePhrasing, type PlacingWord, placementNote, takesNotes } from "./placement.js";
import type { CandidateState } from "./reactionFold.js";
import { typedWorkstreamDetail } from "./store/decode.js";
import { DONE_MILESTONE_ID } from "./store/doneMilestoneId.js";
import type { WorkstreamAggregate } from "./store/types.js";

/** The per-candidate lists of what the seat owes, each named as the candidates document names it. */
export type OwedList = "definitionOwed" | "placementOwed" | "promotionOwed" | "retractions";

/** The words that say it WAS a workstream of the owner's, so it owes a register entry. */
const ITS_OWN: ReadonlySet<Reaction | null> = new Set<Reaction | null>(["yes", "abandoned", "done"]);

/**
 * Whether the register workstream an abandoned word landed on carries an ending.
 *
 * @param id the register id the candidate is held under
 * @param workstreams the register's workstreams
 * @returns true when that workstream has an ending
 */
function carriesEnding({
  id,
  workstreams,
}: {
  id: string | undefined;
  workstreams: readonly WorkstreamAggregate[];
}): boolean {
  const entry = workstreams.find((one) => one.id === id);
  if (entry === undefined) {
    return false;
  }
  const typed = typedWorkstreamDetail({ aggregate: entry });
  if (typed.kind === "local") {
    return false;
  }
  return typed.detail.ending !== null;
}

/**
 * Whether an accepted candidate's workstream still owes its standing definition: a yes, a definition, and an outcome
 * or standing workstream whose `done` milestone does not say it. One whose definition of done is some other
 * milestone has none a definition can rename, so it owes nothing.
 *
 * @param held the register id the candidate is held under
 * @param definition its standing definition, if any
 * @returns true when the workstream owes it
 */
function owesDefinition({
  held,
  definition,
  reaction,
  workstreams,
}: {
  held: string | undefined;
  definition: DefinitionRow | undefined;
  reaction: Reaction | null;
  workstreams: readonly WorkstreamAggregate[];
}): boolean {
  if (reaction !== "yes" || definition === undefined) {
    return false;
  }
  const entry = workstreams.find((one) => one.id === held);
  if (entry === undefined || (entry.kind !== "outcome" && entry.kind !== "standing")) {
    return false;
  }
  if (!entry.milestones.some((one) => one.id === DONE_MILESTONE_ID)) {
    return false;
  }
  return !definitionApplied({ aggregate: entry, row: definition });
}

/**
 * Whether a placing word's note is missing from the workstream it names: a same-as, a milestone-of, or a no covered
 * by another workstream, whose register write did not land.
 *
 * @param state the candidate's standing word
 * @returns true when the note is owed
 */
function owesPlacement({
  candidate,
  state,
  workstreams,
}: {
  candidate: Candidate;
  state: CandidateState;
  workstreams: readonly WorkstreamAggregate[];
}): boolean {
  let target: string | null = null;
  let word: PlacingWord = "covered-by";
  if (state.reaction === "same-as") {
    target = state.sameAs;
    word = "same-as";
  } else if (state.reaction === "milestone-of") {
    target = state.milestoneOf;
    word = "milestone-of";
  } else if (state.reaction === "outcome-of") {
    target = state.outcomeOf;
    word = "outcome-of";
  } else if (state.reaction === "no") {
    target = state.coveredBy;
  }
  if (target === null) {
    return false;
  }
  const entry = workstreams.find((one) => one.id === target);
  if (entry === undefined) {
    return true;
  }
  if (!takesNotes({ workstream: entry })) {
    return false;
  }
  const text = placementNote({ candidate, reason: state.reason, word });
  return !entry.entries.some((one) => notePhrasing({ text: one.text }) === text);
}

/**
 * Which of the seat's lists an answered candidate belongs on.
 *
 * @param held the register id the candidate is held under
 * @param standing its standing definition, if any
 * @param state its standing word
 * @returns the lists, in the document's order
 */
export function owedLists({
  candidate,
  held,
  standing,
  state,
  workstreams,
}: {
  candidate: Candidate;
  held: string | undefined;
  standing: DefinitionRow | undefined;
  state: CandidateState;
  workstreams: readonly WorkstreamAggregate[];
}): readonly OwedList[] {
  const lists: OwedList[] = [];
  // An abandoned or done word is still "it was a workstream", so it owes an entry like a yes does; an abandoned
  // one's entry owes its ending too.
  const itWasOne = ITS_OWN.has(state.reaction);
  const unended = state.reaction === "abandoned" && !carriesEnding({ id: held, workstreams });
  if ((itWasOne && held === undefined) || unended) {
    lists.push("promotionOwed");
  }
  if (owesDefinition({ definition: standing, held, reaction: state.reaction, workstreams })) {
    lists.push("definitionOwed");
  }
  if (owesPlacement({ candidate, state, workstreams })) {
    lists.push("placementOwed");
  }
  // A tile a yes promoted, whose yes the owner has replaced; an entry the candidate merely echoes, or one they named
  // it the same as, was never that yes's.
  const promotedByTheirYes = held !== undefined && held !== candidate.inRegister && held !== state.sameAs;
  if (!itWasOne && state.reaction !== "same-as" && promotedByTheirYes) {
    lists.push("retractions");
  }
  return lists;
}
