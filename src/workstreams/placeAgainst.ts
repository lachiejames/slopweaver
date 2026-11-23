/**
 * A word that names another workstream — same-as, milestone-of, outcome-of, or a no covered by one — placed on the
 * plan: its note, and for a milestone the milestone, left on the workstream it names.
 *
 * Pure. `./placePick.ts` routes a pick here.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import type { Candidate, Reaction } from "./candidates.js";
import { milestoneFrom, noteEntry, type PlacingWord, placementNote, takesMilestones, takesNotes } from "./placement.js";
import { marksOn, type PlanSoFar, type RowFields } from "./planSoFar.js";
import type { WorkstreamAggregate } from "./store/types.js";

/**
 * The register workstream a placing word names, or the refusal: it must be on the register, and a milestone can only
 * be filed inside a workstream that has milestones.
 *
 * @param target the register id the word names, or `null` when it named none
 * @param flag the flag that names it, for the refusal
 * @returns the workstream, or the refusal
 */
function targetOf({
  candidate,
  flag,
  target,
  word,
  workstreams,
}: {
  candidate: Candidate;
  flag: string;
  target: string | null;
  word: Reaction;
  workstreams: readonly WorkstreamAggregate[];
}): Result<WorkstreamAggregate, CandidatesError> {
  if (target === null) {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${candidate.id} is ${word}, which names a workstream (${flag})`],
      }),
    );
  }
  const entry = workstreams.find((one) => one.id === target);
  if (entry === undefined) {
    return err(
      CandidatesErrors.reactionRefused({ problems: [`${flag} ${target} is not a workstream on the register`] }),
    );
  }
  if ((word === "milestone-of" || word === "outcome-of") && !takesNotes({ workstream: entry })) {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${target} is a ${entry.kind} entry, which has no timeline to file ${candidate.id} on`],
      }),
    );
  }
  if (word === "milestone-of" && !takesMilestones({ workstream: entry })) {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${target} is a ${entry.kind} entry, which has no milestones to file ${candidate.id} inside`],
      }),
    );
  }
  return ok(entry);
}

/** The words that name another workstream and leave a note on it. */
export type PlacingReaction = "same-as" | "milestone-of" | "outcome-of" | "no";

/**
 * Place a word that names another workstream — same-as, milestone-of, outcome-of, or a no covered by one — leaving its
 * note (and, for a milestone, the milestone) on that workstream.
 *
 * @returns nothing a new workstream took, or the refusal
 */
export function placeAgainst({
  candidate,
  fields,
  nowIso,
  reaction,
  so,
  workstreams,
}: {
  candidate: Candidate;
  fields: RowFields;
  nowIso: string;
  reaction: PlacingReaction;
  so: PlanSoFar;
  workstreams: readonly WorkstreamAggregate[];
}): Result<null, CandidatesError> {
  let flag = "--covered-by";
  let target = fields.coveredBy;
  let word: PlacingWord = "covered-by";
  if (reaction === "same-as") {
    flag = "--same-as";
    target = fields.sameAs;
    word = "same-as";
  } else if (reaction === "milestone-of") {
    flag = "--milestone-of";
    target = fields.milestoneOf;
    word = "milestone-of";
  } else if (reaction === "outcome-of") {
    flag = "--outcome-of";
    target = fields.outcomeOf;
    word = "outcome-of";
  }
  const entry = targetOf({ candidate, flag, target, word: reaction, workstreams });
  if (entry.isErr()) {
    return err(entry.error);
  }
  const marks = marksOn({ id: entry.value.id, so });
  marks.notes.push(noteEntry({ nowIso, text: placementNote({ candidate, reason: fields.reason, word }) }));
  if (reaction === "milestone-of") {
    const taken = new Set([...entry.value.milestones, ...marks.milestones].map((one) => one.id));
    marks.milestones.push(milestoneFrom({ candidate, taken }));
  }
  so.placed.push({ as: entry.value.id, candidate: candidate.id, word: reaction });
  return ok(null);
}
