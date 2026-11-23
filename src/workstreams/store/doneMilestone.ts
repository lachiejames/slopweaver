/**
 * The definition of done as a milestone, for the writers the cutover moves onto the store: a promoted candidate, a
 * redefinition, and a milestone placed under a workstream.
 *
 * Each workstream carries its own milestones and the last is its definition of done. The store refuses an `outcome`,
 * `standing` or `linked` workstream with none (`./validation.ts`), and a promoted candidate starts with none, so
 * promotion authors one:
 *
 * - The definition of done has ONE stable id, {@link DONE_MILESTONE_ID}, for the life of the workstream. Redefining it
 *   renames that milestone in place and appends a note; it never appends a second final milestone, so a link or an
 *   entry naming `done` still names the definition of done after the owner changes their mind.
 * - Its name is the definition the owner picked, else the candidate's outcome; its anchor is where they said it — the
 *   reaction's anchor, else, for a press that carries none, the candidate it came from (`candidate:<id>`).
 * - A milestone placed under a workstream goes BEFORE `done`, and `done` waits on it.
 *
 * Every id already on the aggregate is carried through; the caller mints the one new entry id. Dormant: nothing in
 * production calls these until the verbs move onto the store.
 *
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { Candidate } from "../candidates.js";
import { DEFINITION_NOTE_PREFIX, type DefinitionRow, definitionNote } from "../definitions.js";

import { byCodeUnit } from "./canonical.js";
import { DONE_MILESTONE_ID } from "./doneMilestoneId.js";
import { type WorkstreamInvalidError, WorkstreamStoreErrors } from "./errors.js";
import { judgeProposedAggregate } from "./judge.js";
import { STORE_INTEGER_MAX, unstorableStrings } from "./storable.js";
import type { WorkstreamAggregate, WorkstreamEntry, WorkstreamMilestone } from "./types.js";
import { oneMilestoneProblems } from "./validation.js";

export { DONE_MILESTONE_ID } from "./doneMilestoneId.js";

/**
 * The one milestone a promoted candidate starts with: its definition of done.
 *
 * @param candidate the candidate being promoted
 * @param definition the definition the owner picked for it, or `null` when none is picked
 * @param reactionAnchor where the owner's yes was said; `null` for a press
 * @returns the milestone, at position 0 with nothing before it — or, when its name or anchor is one the store would
 *   refuse, every problem
 */
export function promotedDoneMilestone({
  candidate,
  definition,
  reactionAnchor,
}: {
  candidate: Pick<Candidate, "id" | "outcome">;
  definition: DefinitionRow | null;
  reactionAnchor: string | null;
}): Result<WorkstreamMilestone, WorkstreamInvalidError> {
  let name = candidate.outcome;
  if (definition !== null) {
    name = definition.selection.text;
  }
  let anchor = `candidate:${candidate.id}`;
  if (reactionAnchor !== null) {
    anchor = reactionAnchor;
  }
  const milestone: WorkstreamMilestone = { after: [], anchor, id: DONE_MILESTONE_ID, name, position: 0 };
  const problems = [
    ...oneMilestoneProblems({ one: milestone, owner: candidate.id }),
    ...unstorableStrings({ path: `${candidate.id} milestone ${DONE_MILESTONE_ID}`, value: milestone }).map(
      (path) => `${path} carries U+0000 or a lone surrogate`,
    ),
  ];
  if (problems.length > 0) {
    return err(WorkstreamStoreErrors.invalid({ problems }));
  }
  return ok(milestone);
}

/**
 * The aggregate's definition of done, when it is the `done` milestone and the last one.
 *
 * @returns the milestone, or why the aggregate has no `done` milestone to work on
 */
function doneOf({
  aggregate,
}: {
  aggregate: WorkstreamAggregate;
}): Result<WorkstreamMilestone, WorkstreamInvalidError> {
  const done = aggregate.milestones.filter((one) => one.id === DONE_MILESTONE_ID);
  const [only] = done;
  if (only === undefined || done.length > 1) {
    const problem = `${aggregate.id} carries ${String(done.length)} milestones with the id ${DONE_MILESTONE_ID}, not one`;
    return err(WorkstreamStoreErrors.invalid({ problems: [problem] }));
  }
  if (aggregate.milestones.some((one) => one.position > only.position)) {
    const problem = `${aggregate.id}'s ${DONE_MILESTONE_ID} milestone is not its last, so it is not the definition of done`;
    return err(WorkstreamStoreErrors.invalid({ problems: [problem] }));
  }
  return ok(only);
}

/**
 * The position a new entry takes: after every entry the aggregate holds.
 *
 * @returns the position, or why the store could not hold it
 */
function nextEntryPosition({ aggregate }: { aggregate: WorkstreamAggregate }): Result<number, WorkstreamInvalidError> {
  const last = Math.max(-1, ...aggregate.entries.map((entry) => entry.position));
  if (last >= STORE_INTEGER_MAX) {
    const problem = `${aggregate.id}'s entries already reach the largest position the store holds`;
    return err(WorkstreamStoreErrors.invalid({ problems: [problem] }));
  }
  return ok(last + 1);
}

/**
 * The aggregate with a definition of done carried onto it: the `done` milestone renamed to the definition and
 * re-anchored where the owner gave it, the outcome set to it, and one note appended saying what was picked — or the aggregate
 * untouched when it already says exactly this definition (its latest definition note this one), so a retry appends nothing.
 *
 * @param definition the standing definition
 * @param anchor where the owner gave it
 * @param entryId the fresh UUID the note takes, minted by the caller
 * @returns the aggregate, or why it has no definition of done to rename
 */
export function redefineDone({
  aggregate,
  anchor,
  definition,
  entryId,
}: {
  aggregate: WorkstreamAggregate;
  anchor: string;
  definition: DefinitionRow;
  entryId: string;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  const done = doneOf({ aggregate });
  if (done.isErr()) {
    return err(done.error);
  }
  const name = definition.selection.text;
  const noteText = definitionNote({ row: definition }).text;
  const latestNote = aggregate.entries
    .filter((entry) => entry.kind === "note" && entry.text.startsWith(DEFINITION_NOTE_PREFIX))
    .toSorted((a, b) => a.position - b.position)
    .at(-1);
  const applied = done.value.name === name && aggregate.outcome === name && latestNote?.text === noteText;
  if (applied) {
    return storable({ aggregate });
  }
  const position = nextEntryPosition({ aggregate });
  if (position.isErr()) {
    return err(position.error);
  }
  const note: WorkstreamEntry = {
    date: definition.iso.slice(0, 10),
    done: false,
    href: null,
    id: entryId,
    kind: "note",
    milestoneId: null,
    position: position.value,
    text: noteText,
  };
  return storable({
    aggregate: {
      ...aggregate,
      entries: [...aggregate.entries, note],
      milestones: aggregate.milestones.map((one) => (one.id === DONE_MILESTONE_ID ? { ...one, anchor, name } : one)),
      outcome: name,
    },
  });
}

/**
 * The aggregate with one more milestone, placed immediately before `done`, which now waits on it. Positions are
 * re-dealt in authored order from 0, so the new milestone never needs a position past the store's range.
 *
 * @param milestone the milestone to place, without a position
 * @returns the aggregate, or why the milestone cannot be placed
 */
export function placeBeforeDone({
  aggregate,
  milestone,
}: {
  aggregate: WorkstreamAggregate;
  milestone: Omit<WorkstreamMilestone, "position">;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  const done = doneOf({ aggregate });
  if (done.isErr()) {
    return err(done.error);
  }
  if (aggregate.milestones.some((one) => one.id === milestone.id)) {
    const problem = `${aggregate.id} already carries a milestone with the id ${milestone.id}`;
    return err(WorkstreamStoreErrors.invalid({ problems: [problem] }));
  }
  if (milestone.after.includes(DONE_MILESTONE_ID)) {
    const problem = `${milestone.id} would wait on ${DONE_MILESTONE_ID}, which waits on it; a milestone placed before ${DONE_MILESTONE_ID} cannot follow it`;
    return err(WorkstreamStoreErrors.invalid({ problems: [problem] }));
  }
  const before = aggregate.milestones
    .filter((one) => one.id !== DONE_MILESTONE_ID)
    .toSorted((a, b) => a.position - b.position);
  const doneAfter = [...new Set([...done.value.after, milestone.id])].toSorted((a, b) => byCodeUnit({ a, b }));
  const ordered: WorkstreamMilestone[] = [
    ...before,
    { ...milestone, position: 0 },
    { ...done.value, after: doneAfter },
  ];
  return storable({ aggregate: { ...aggregate, milestones: ordered.map((one, at) => ({ ...one, position: at })) } });
}

/**
 * The aggregate as it stands, once the store's own judge accepts it — so nothing these helpers return is refused on
 * write.
 *
 * @returns the aggregate unchanged, or every problem the store would refuse it for
 */
function storable({
  aggregate,
}: {
  aggregate: WorkstreamAggregate;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  const judged = judgeProposedAggregate({ aggregate });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  return ok(aggregate);
}
