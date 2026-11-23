/**
 * The placing half of a reaction plan: where each of the owner's words lands on the register — a new workstream, an ending on
 * one, a note on another workstream, a closing workstream — added to a `PlanSoFar` (`./planSoFar.ts`) pick by pick.
 *
 * Pure. `./promotion.ts` builds the plan around it (`planReactions`) and stamps each pick's row. Every new entry id
 * comes from the caller's `mintId`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import type { Candidate, ReactionRow } from "./candidates.js";
import { freeEntryId, newTile } from "./candidateTile.js";
import { type DefinitionRow, definitionApplied } from "./definitions.js";
import { placeAgainst } from "./placeAgainst.js";
import { closingFrom, noteEntry, placementNote } from "./placement.js";
import { type Ending, marksOn, type PlanSoFar, type RowFields } from "./planSoFar.js";
import type { ReactionPick } from "./reactionBatch.js";
import { DONE_MILESTONE_ID, redefineDone } from "./store/doneMilestone.js";
import type { WorkstreamAggregate } from "./store/types.js";

/**
 * Place one pick on the plan: end the workstream an abandoned word names, note a yes the register already holds, or
 * add the workstream a yes or abandoned on an unheld candidate becomes. Any other word on its own writes only its row.
 *
 * @param holding the register id the candidate is already held under, if any
 * @param ending the ending an abandoned word writes; `null` for any other word
 * @param definition the candidate's standing definition of done, or `null`
 * @param fields the placement this word's row records
 * @param title the title the owner gave it, which a new workstream takes instead of the mined name; `null` when none was given
 * @param workstreams the register's workstreams plus the ones this batch has added so far
 * @param so what the batch has planned so far, added to in place
 * @param reactionAnchor where the owner said it, which anchors a definition of done; `null` for a press
 * @param mintId the fresh canonical UUID each new entry takes
 * @returns the id a new workstream took (`null` when none was added), or the refusal
 */
export function placePick({
  candidate,
  definition,
  ending,
  fields,
  held,
  holding,
  mintId,
  nowIso,
  reaction,
  reactionAnchor,
  so,
  title,
  workstreams,
}: {
  candidate: Candidate;
  definition: DefinitionRow | null;
  ending: Ending | null;
  fields: RowFields;
  held: readonly ReactionRow[];
  holding: string | undefined;
  mintId: () => string;
  nowIso: string;
  reaction: ReactionPick["reaction"];
  reactionAnchor: string | null;
  so: PlanSoFar;
  title: string | null;
  workstreams: readonly WorkstreamAggregate[];
}): Result<string | null, CandidatesError> {
  const namesAnother = reaction === "same-as" || reaction === "milestone-of" || reaction === "outcome-of";
  if (namesAnother || (reaction === "no" && fields.coveredBy !== null)) {
    return placeAgainst({ candidate, fields, nowIso, reaction, so, workstreams });
  }
  const entitled = title === null ? candidate : { ...candidate, name: title };
  if (reaction === "done") {
    return placeDone({ candidate: entitled, held, holding, mintId, nowIso, reason: fields.reason, so });
  }
  const placed = placeWord({
    candidate: entitled,
    definition,
    ending,
    held,
    holding,
    mintId,
    nowIso,
    reaction,
    reactionAnchor,
    so,
    workstreams,
  });
  if (placed.isOk() && reaction === "yes" && fields.steer !== null) {
    noteSteer({ candidate, holding, nowIso, placed: placed.value, so, steer: fields.steer });
  }
  return placed;
}

/**
 * Leave a yes's steer on the workstream it answers, whether this yes added it or found it already held.
 *
 * @param placed the id a new workstream took, `null` when the yes added none
 * @param holding the register id the candidate is already held under, if any
 * @param steer what the owner steered the yes toward
 */
function noteSteer({
  candidate,
  holding,
  nowIso,
  placed,
  so,
  steer,
}: {
  candidate: Candidate;
  holding: string | undefined;
  nowIso: string;
  placed: string | null;
  so: PlanSoFar;
  steer: string;
}): void {
  let onto = holding;
  if (placed !== null) {
    onto = placed;
  }
  if (onto !== undefined) {
    marksOn({ id: onto, so }).notes.push(
      noteEntry({ nowIso, text: placementNote({ candidate, reason: steer, word: "steer" }) }),
    );
  }
}

/**
 * Place a done word: a closing workstream kept on the register, unless the candidate is already held there, where
 * marking that workstream done is the seat's.
 *
 * @param candidate the candidate, carrying the title the owner gave it as its name when they gave one
 * @param holding the register id the candidate is already held under, if any
 * @param reason what the owner said about it being done, if anything
 * @returns the id the closing workstream took, or the refusal
 */
function placeDone({
  candidate,
  held,
  holding,
  mintId,
  nowIso,
  reason,
  so,
}: {
  candidate: Candidate;
  held: readonly ReactionRow[];
  holding: string | undefined;
  mintId: () => string;
  nowIso: string;
  reason: string | null;
  so: PlanSoFar;
}): Result<string, CandidatesError> {
  if (holding !== undefined) {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${candidate.id} is already on the register as ${holding}; marking that entry done is the seat's`],
      }),
    );
  }
  const id = freeEntryId({ candidate, held, taken: so.taken });
  so.taken.add(id);
  so.added.push(closingFrom({ candidate, id, mintId, nowIso, reason }));
  so.promoted.push({ as: id, candidate: candidate.id });
  return ok(id);
}

/**
 * Carry a standing definition onto the workstream a yes found already held. Only an outcome or standing workstream
 * whose definition of done is the `done` milestone has one a definition can rename — a linked, closing or page-only
 * one the candidate echoes, or one whose last milestone is some other, is left as written.
 *
 * @param definition the candidate's standing definition, or `null` when none was picked
 * @param entry the register workstream already holding the candidate
 * @param anchor where the owner said the yes; the `done` milestone keeps its own anchor when `null`
 * @param so the plan so far, whose updates take the changed workstream
 * @returns nothing, or why the store would refuse the renamed workstream
 */
function carryDefinition({
  anchor,
  definition,
  entry,
  mintId,
  so,
}: {
  anchor: string | null;
  definition: DefinitionRow | null;
  entry: WorkstreamAggregate;
  mintId: () => string;
  so: PlanSoFar;
}): Result<null, CandidatesError> {
  const done = entry.milestones.find((one) => one.id === DONE_MILESTONE_ID);
  const own = entry.kind === "outcome" || entry.kind === "standing";
  if (definition === null || !own || done === undefined || definitionApplied({ aggregate: entry, row: definition })) {
    return ok(null);
  }
  let where = done.anchor;
  if (anchor !== null) {
    where = anchor;
  }
  const updated = redefineDone({ aggregate: entry, anchor: where, definition, entryId: mintId() });
  if (updated.isErr()) {
    return err(CandidatesErrors.registerRefused({ cause: updated.error }));
  }
  so.updated.set(entry.id, updated.value);
  return ok(null);
}

/**
 * End the workstream an abandoned word names, already on the register; a page-only one has no outcome to end.
 *
 * @param holding the register id the candidate is held under
 * @returns nothing a new workstream took, or the refusal
 */
function endHeld({
  candidate,
  ending,
  holding,
  so,
  workstreams,
}: {
  candidate: Candidate;
  ending: Ending;
  holding: string;
  so: PlanSoFar;
  workstreams: readonly WorkstreamAggregate[];
}): Result<null, CandidatesError> {
  if (workstreams.find((one) => one.id === holding)!.kind === "local") {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${candidate.id} is held as ${holding}, a page-only entry, which has no outcome to end`],
      }),
    );
  }
  so.endings.set(holding, ending);
  so.ended.push({ as: holding, candidate: candidate.id });
  return ok(null);
}

/**
 * Place a yes, abandoned or plain word: end the workstream an abandoned word names, note a yes the register already
 * holds, or add the workstream a yes or abandoned on an unheld candidate becomes. Any other word on its own writes
 * only its row.
 *
 * @param candidate the candidate, carrying the title the owner gave it as its name when they gave one
 * @returns the id a new workstream took (`null` when none was added), or the refusal for a page-only one
 */
function placeWord({
  candidate,
  definition,
  ending,
  held,
  holding,
  mintId,
  nowIso,
  reaction,
  reactionAnchor,
  so,
  workstreams,
}: {
  candidate: Candidate;
  definition: DefinitionRow | null;
  ending: Ending | null;
  held: readonly ReactionRow[];
  holding: string | undefined;
  mintId: () => string;
  nowIso: string;
  reaction: ReactionPick["reaction"];
  reactionAnchor: string | null;
  so: PlanSoFar;
  workstreams: readonly WorkstreamAggregate[];
}): Result<string | null, CandidatesError> {
  if (ending !== null && holding !== undefined) {
    return endHeld({ candidate, ending, holding, so, workstreams });
  }
  if (reaction === "yes" && holding !== undefined) {
    so.alreadyHeld.push({ as: holding, candidate: candidate.id });
    // A second yes in the same batch carries onto what the first already changed.
    let entry = workstreams.find((one) => one.id === holding)!;
    const carried = so.updated.get(holding);
    if (carried !== undefined) {
      entry = carried;
    }
    return carryDefinition({ anchor: reactionAnchor, definition, entry, mintId, so }).map(() => null);
  }
  if (reaction !== "yes" && ending === null) {
    return ok(null);
  }
  const entry = newTile({ candidate, definition, ending, held, mintId, nowIso, reactionAnchor, taken: so.taken });
  if (entry.isErr()) {
    return err(CandidatesErrors.registerRefused({ cause: entry.error }));
  }
  so.taken.add(entry.value.id);
  so.added.push(entry.value);
  so.promoted.push({ as: entry.value.id, candidate: candidate.id });
  if (ending !== null) {
    so.ended.push({ as: entry.value.id, candidate: candidate.id });
  }
  return ok(entry.value.id);
}

/**
 * The ending an abandoned word writes — dated the day the owner said it, with their reason and where they said it — or `null`
 * for any other word. An abandoned word without both is refused, never written with a gap.
 *
 * @param candidate the candidate id, for the refusal
 * @returns the ending, `null`, or the refusal
 */
export function endingFor({
  anchor,
  candidate,
  nowIso,
  reaction,
  reason,
}: {
  anchor: string | null;
  candidate: string;
  nowIso: string;
  reaction: ReactionPick["reaction"];
  reason: string | null;
}): Result<Ending | null, CandidatesError> {
  if (reaction !== "abandoned") {
    return ok(null);
  }
  if (reason === null || reason.trim().length === 0 || anchor === null || anchor.trim().length === 0) {
    return err(
      CandidatesErrors.reactionRefused({
        problems: [`${candidate} is abandoned, which needs why (--reason) and where the owner said it (--anchor)`],
      }),
    );
  }
  return ok({ anchor, kind: "abandoned", on: nowIso.slice(0, 10), reason });
}
