/**
 * The workstream a candidate becomes on the owner's yes or abandoned word: its id, the `mined:<id>` tag that finds it again,
 * its definition of done, and its dated entries from the cited evidence.
 *
 * Pure. `./promotion.ts` decides WHEN a candidate becomes a workstream; this decides what the workstream is. Every new
 * entry takes an id from the caller's `mintId`, so a planner never mints one itself.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type Candidate, type ReactionRow, STORY_OWED } from "./candidates.js";
import type { DefinitionRow } from "./definitions.js";
import type { Ending } from "./planSoFar.js";
import type { OwnWorkstreamDetail } from "./store/decode.js";
import { promotedDoneMilestone, redefineDone } from "./store/doneMilestone.js";
import { type WorkstreamInvalidError, WorkstreamStoreErrors } from "./store/errors.js";
import { judgeProposedAggregate } from "./store/judge.js";
import type { WorkstreamAggregate, WorkstreamEntry } from "./store/types.js";

/** A dated entry before it takes an id and a position on the workstream it lands on. */
export type PendingEntry = Omit<WorkstreamEntry, "id" | "position">;

/**
 * A name as the base of the register id it would become: lowercased, every run of other characters one hyphen, at
 * most 60 characters. Lossy on purpose (an id is ASCII kebab); `freeId` suffixes a clash, so it never decides identity.
 *
 * @returns the key, empty for a name with no letter or digit
 */
function nameKey({ name }: { name: string }): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/**
 * A register id for a candidate's name: kebab-case, falling back to the candidate's own id when the name has no
 * letters or digits, then suffixed until no entry in `taken` holds it.
 *
 * @returns the free id
 */
function freeId({ candidate, taken }: { candidate: Candidate; taken: ReadonlySet<string> }): string {
  let base = nameKey({ name: candidate.name });
  if (base.length === 0) {
    base = candidate.id;
  }
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${String(suffix)}`;
  }
  return id;
}

/**
 * The tag a promoted workstream carries naming the candidate it came from, so the next yes finds it rather than
 * promote it a second time.
 *
 * @returns the tag
 */
export function minedTag({ candidateId }: { candidateId: string }): string {
  return `mined:${candidateId}`;
}

/**
 * Entries appended after every entry a workstream already holds, each with a fresh id and the next position.
 *
 * @param entries the workstream's entries as they stand, kept exactly
 * @param pending the entries to append, in order
 * @param mintId the fresh canonical UUID each appended entry takes
 * @returns every entry, the appended ones last
 */
export function appendEntries({
  entries,
  pending,
  mintId,
}: {
  entries: readonly WorkstreamEntry[];
  pending: readonly PendingEntry[];
  mintId: () => string;
}): WorkstreamEntry[] {
  const last = Math.max(-1, ...entries.map((entry) => entry.position));
  return [...entries, ...pending.map((one, at) => ({ ...one, id: mintId(), position: last + 1 + at }))];
}

/**
 * The aggregate once the store's own judge accepts it, so nothing a planner returns is refused on write.
 *
 * @returns the aggregate, or every problem the store would refuse it for
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

/**
 * The workstream a yes'd candidate becomes: standing, discovery, its definition of done the `done` milestone
 * (`promotedDoneMilestone`), its entries the cited evidence ({@link timelineFromCandidate}), and {@link STORY_OWED} in
 * each story field it cannot know.
 *
 * The people a candidate owes a conversation are carried as its `people`, each by Slack member id with why they need
 * to be across it, and a standing definition of done names its `done` milestone and becomes its `outcome`, with a note
 * saying so. A mined owning team is its `team`, and the candidate's `boardMembership` is the workstream's, unchanged.
 *
 * @param candidate the candidate the owner said yes (or abandoned) to
 * @param taken every id the register already holds, so the new one is unique
 * @param reactedOn the day the owner said it
 * @param ending how it ended, for a candidate the owner called abandoned; `null` for a yes
 * @param definition what done means for it, picked before the yes; `null` when none was, so the mined outcome stands
 * @param reactionAnchor where the owner said it, which anchors the definition of done; `null` for a press
 * @param mintId the fresh canonical UUID each entry takes
 * @returns the workstream, or why the store would refuse it
 */
export function entryFromCandidate({
  candidate,
  taken,
  reactedOn,
  ending,
  definition,
  reactionAnchor,
  mintId,
}: {
  candidate: Candidate;
  taken: ReadonlySet<string>;
  reactedOn: string;
  ending: Ending | null;
  definition: DefinitionRow | null;
  reactionAnchor: string | null;
  mintId: () => string;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  const done = promotedDoneMilestone({ candidate, definition, reactionAnchor });
  if (done.isErr()) {
    return err(done.error);
  }
  const detail: OwnWorkstreamDetail = {
    agreedBy: STORY_OWED,
    // Which board rows sit under it travels with the outcome, so the supervisor's coverage reads it off the register.
    boardMembership: candidate.boardMembership,
    ending,
    feedback: [],
    initiative: null,
    numbers: STORY_OWED,
    // `candidate.people` are names, and the register wants Slack member ids: the seat adds the rest with the story.
    // The people owed a conversation already carry their ids, so they are on the workstream from the start.
    people: candidate.loopIn.map((one) => ({ part: one.why, slack: one.slack })),
    priority: null,
    skeptic: null,
    statusNote: `the owner's ${ending === null ? "yes" : "word abandoned"} on ${reactedOn}, from the mined candidates`,
    tags: ["mined", minedTag({ candidateId: candidate.id }), candidate.theme],
    team: candidate.owningTeam === null ? STORY_OWED : candidate.owningTeam.name,
    waitingOn: null,
  };
  const mined: WorkstreamAggregate = {
    detail,
    entries: appendEntries({ entries: [], mintId, pending: timelineFromCandidate({ candidate }) }),
    id: freeId({ candidate, taken }),
    kind: "standing",
    links: [],
    milestones: [done.value],
    name: candidate.name,
    outcome: candidate.outcome,
    status: "discovery",
    workspace: candidate.workspace,
  };
  if (definition === null) {
    return storable({ aggregate: mined });
  }
  return redefineDone({ aggregate: mined, anchor: done.value.anchor, definition, entryId: mintId() });
}

/**
 * A candidate's cited evidence as dated entries: in date order, the first `raised` and the rest `discussion`, none
 * moving a milestone, then each earlier steer of the owner's it answers as a dated note. A transcript or owner-turn anchor has
 * no field on an entry, so it is kept in the entry's text, in brackets, whenever the evidence has no link. What a
 * yes'd workstream and a done closing one both start their story from.
 *
 * @returns the entries, before they take ids and positions
 */
export function timelineFromCandidate({ candidate }: { candidate: Candidate }): PendingEntry[] {
  const evidence = candidate.evidence.toSorted((a, b) => a.date.localeCompare(b.date));
  return [
    ...evidence.map((one, position): PendingEntry => ({
      date: one.date,
      done: false,
      href: one.href,
      kind: position === 0 ? "raised" : "discussion",
      milestoneId: null,
      text: one.href === null && one.anchor !== null ? `${one.quote} [${one.anchor}]` : one.quote,
    })),
    // The owner's earlier steers it answers stay on the workstream, each on the day it was given, after the evidence that raised it.
    ...candidate.priorSteers.map((steer): PendingEntry => ({
      date: steer.date,
      done: false,
      href: null,
      kind: "note",
      milestoneId: null,
      text: `The owner's earlier steer: ${steer.text} [${steer.anchor}]`,
    })),
  ];
}

/**
 * The ids another candidate's row names as the workstream it became, reserved for that candidate's owed promotion.
 *
 * @returns the reserved ids
 */
function reservedIds({ candidate, held }: { candidate: Candidate; held: readonly ReactionRow[] }): readonly string[] {
  return held.flatMap((one) => (one.promotedAs !== null && one.candidate !== candidate.id ? [one.promotedAs] : []));
}

/**
 * A register id for a candidate's new workstream of any kind, clear of every id the register holds and every id
 * another candidate's row names — what {@link newTile} gives a workstream, for the closing one a done word adds.
 *
 * @param held every reaction row recorded so far, whose `promotedAs` ids are reserved
 * @param taken every id the register holds, including workstreams this batch adds
 * @returns the free id
 */
export function freeEntryId({
  candidate,
  held,
  taken,
}: {
  candidate: Candidate;
  held: readonly ReactionRow[];
  taken: ReadonlySet<string>;
}): string {
  return freeId({ candidate, taken: new Set([...taken, ...reservedIds({ candidate, held })]) });
}

/**
 * The workstream a yes or abandoned on an unheld candidate becomes, its id clear of every id the register holds and
 * every id another candidate's row names.
 *
 * @param held every reaction row recorded so far, whose `promotedAs` ids are reserved
 * @param taken every id the register holds, including workstreams this batch adds
 * @param ending how it ended, for an abandoned word; `null` for a yes
 * @param definition the standing definition of done, or `null`
 * @param reactionAnchor where the owner said it; `null` for a press
 * @param mintId the fresh canonical UUID each entry takes
 * @returns the workstream, or why the store would refuse it
 */
export function newTile({
  candidate,
  definition,
  ending,
  held,
  mintId,
  nowIso,
  reactionAnchor,
  taken,
}: {
  candidate: Candidate;
  definition: DefinitionRow | null;
  ending: Ending | null;
  held: readonly ReactionRow[];
  mintId: () => string;
  nowIso: string;
  reactionAnchor: string | null;
  taken: ReadonlySet<string>;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  return entryFromCandidate({
    candidate,
    definition,
    ending,
    mintId,
    reactedOn: nowIso.slice(0, 10),
    reactionAnchor,
    taken: new Set([...taken, ...reservedIds({ candidate, held })]),
  });
}
