/**
 * Where a word places a candidate against what the register already holds, and the sticky context each placement
 * leaves on the workstream it names: a dated note, an own milestone placed before its definition of done, or a
 * closing workstream for a done one.
 *
 * Walking the candidates with the console voice, the owner marks one done, names the workstream it already is, files
 * one as a milestone of another (a blocker that came up midway), declines one as someone else's or as covered by
 * another workstream's side effect, and accepts one as a steer already given. Every one of those is durable context
 * a later session reads, so each lands on the register rather than only in the ledger.
 *
 * Pure. `./promotion.ts` decides which placement a word makes; `./reactionStore.ts` writes the result.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { Candidate } from "./candidates.js";
import { appendEntries, type PendingEntry, timelineFromCandidate } from "./candidateTile.js";
import type { ClosingWorkstreamDetail } from "./store/decode.js";
import { placeBeforeDone } from "./store/doneMilestone.js";
import type { WorkstreamInvalidError } from "./store/errors.js";
import type { WorkstreamAggregate, WorkstreamMilestone } from "./store/types.js";

/**
 * Each note a word can leave on a workstream it names. `outcome-of` is distinct from `milestone-of` on purpose: an outcome
 * the workstream produces, never a step on its way, and never a workstream of its own.
 */
export type PlacingWord = "same-as" | "milestone-of" | "outcome-of" | "covered-by" | "steer";

/** What one call's word carries beyond the word itself; each field is read only by the word it belongs to. */
export interface Placement {
  /** The owner's words on why: a done, no, milestone-of, outcome-of or superseded reason (an abandoned one's is its ending's). */
  readonly reason: string | null;
  /** The register workstream a `same-as` names. */
  readonly sameAs: string | null;
  /** The register workstream a `milestone-of` files it inside. */
  readonly milestoneOf: string | null;
  /** The register workstream an `outcome-of` files it as an outcome of. */
  readonly outcomeOf: string | null;
  /** What replaced it, in the owner's words, on a `superseded`. */
  readonly supersededBy: string | null;
  /** Whose it is, on a `no`. */
  readonly owner: string | null;
  /** The register workstream whose side effect covers it, on a `no`. */
  readonly coveredBy: string | null;
  /** The earlier steer a `yes` matches, in the owner's words. */
  readonly steer: string | null;
}

/** A call that places nothing beyond its word. */
export const NO_PLACEMENT: Placement = {
  coveredBy: null,
  milestoneOf: null,
  outcomeOf: null,
  owner: null,
  reason: null,
  sameAs: null,
  steer: null,
  supersededBy: null,
};

/** An own milestone before it takes a position: `placeBeforeDone` deals every position. */
export type PendingMilestone = Omit<WorkstreamMilestone, "position">;

/** What a batch leaves on one workstream: dated notes and milestones of its own. */
export interface Marks {
  readonly notes: readonly PendingEntry[];
  readonly milestones: readonly PendingMilestone[];
}

/**
 * A dated note, moving no milestone.
 *
 * @param nowIso the instant the owner said it; the note is dated its day
 * @returns the note, before it takes an id and a position
 */
export function noteEntry({ nowIso, text }: { nowIso: string; text: string }): PendingEntry {
  return { date: nowIso.slice(0, 10), done: false, href: null, kind: "note", milestoneId: null, text };
}

/**
 * How a candidate is named inside a note on another workstream: its id and its name as mined.
 *
 * @returns e.g. `mined candidate c-007 "Postmortems that happen"`
 */
function named({ candidate }: { candidate: Candidate }): string {
  return `mined candidate ${candidate.id} "${candidate.name}"`;
}

/** A placement note's opening as an earlier register stored it, for the subject `notePhrasing` reads it under. */
const STORED_PLACEMENT_SUBJECT = /^He (named|filed|declined) /u;

/** The steer placement note as an earlier register stored it. */
const STORED_STEER_NOTE = /^He accepted this as the steer he had already given/u;

/** The steer placement note, as `placementNote` writes it. */
const STEER_NOTE = "The owner accepted this as the steer they had already given";

/**
 * A note's text read in the spelling `placementNote` writes, so a placement note an earlier register stored in its
 * former spelling still counts as the same note wherever a note is compared: a retry in `applyMarks`, and whether a
 * placement is still owed (`./candidateOwed.ts`). The stored entry is never rewritten.
 *
 * @returns the text, its placement opening in the current spelling, any other note unchanged
 */
export function notePhrasing({ text }: { text: string }): string {
  return text.replace(STORED_STEER_NOTE, STEER_NOTE).replace(STORED_PLACEMENT_SUBJECT, "The owner $1 ");
}

/**
 * The note each placing word leaves on the workstream it names. A retry matches on its text (`applyMarks` skips a note
 * the workstream already carries, read through `notePhrasing`).
 *
 * @param word which placement this is
 * @param reason the owner's words on why, appended when there are some
 * @returns the note's text
 */
export function placementNote({
  candidate,
  reason,
  word,
}: {
  candidate: Candidate;
  reason: string | null;
  word: PlacingWord;
}): string {
  let text: string;
  if (word === "same-as") {
    text = `The owner named ${named({ candidate })} as this workstream`;
  } else if (word === "milestone-of") {
    text = `The owner filed ${named({ candidate })} as a milestone of this workstream`;
  } else if (word === "outcome-of") {
    text = `The owner filed ${named({ candidate })} as an outcome of this workstream, not a workstream of its own`;
  } else if (word === "covered-by") {
    text = `The owner declined ${named({ candidate })} as covered by this workstream, as a side effect`;
  } else {
    text = STEER_NOTE;
  }
  if (reason === null) {
    return text;
  }
  return `${text}: ${reason}`;
}

/**
 * The anchor an own milestone filed from a candidate carries, which finds it again so a retry never files it twice.
 *
 * @returns e.g. `mined candidate c-031`
 */
function milestoneAnchor({ candidateId }: { candidateId: string }): string {
  return `mined candidate ${candidateId}`;
}

/**
 * The own milestone a candidate filed inside a workstream becomes: its name, depending on nothing, its id clear of
 * the workstream's other milestones. Placed, it comes before the definition of done, which waits on it.
 *
 * @param taken the milestone ids the workstream already holds
 * @returns the milestone, before it takes a position
 */
export function milestoneFrom({
  candidate,
  taken,
}: {
  candidate: Candidate;
  taken: ReadonlySet<string>;
}): PendingMilestone {
  const base = candidate.id;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${String(suffix)}`;
  }
  return { after: [], anchor: milestoneAnchor({ candidateId: candidate.id }), id, name: candidate.name };
}

/**
 * Whether a workstream has a story a note can land on: every kind but a page-only one, a closing one included,
 * because a completion keeps its story.
 *
 * @returns true for an outcome, standing, linked or closing workstream
 */
export function takesNotes({ workstream }: { workstream: Pick<WorkstreamAggregate, "kind"> }): boolean {
  return workstream.kind !== "local";
}

/**
 * Whether a workstream has milestones of its own a candidate can be filed inside. A closing one keeps its entries but
 * no milestones: it has finished, so nothing is left to happen on its way.
 *
 * @returns true for an outcome, standing or linked workstream
 */
export function takesMilestones({ workstream }: { workstream: Pick<WorkstreamAggregate, "kind"> }): boolean {
  return workstream.kind === "outcome" || workstream.kind === "standing" || workstream.kind === "linked";
}

/**
 * Leave a batch's marks on one workstream, idempotently: a note whose text the workstream already carries, or a
 * milestone whose anchor it already holds, is not added again — so re-recording the same word repairs a failed
 * register write rather than doubling what a good one wrote, and mints no id for what it skips. A milestone goes
 * before the definition of done (`placeBeforeDone`). A closing workstream takes the notes alone: a milestone-of is
 * refused before it can name one (`./placePick.ts`).
 *
 * @param aggregate the workstream as it stands, every id on it kept
 * @param marks what the batch leaves on it
 * @param mintId the fresh canonical UUID each appended note takes
 * @returns the workstream with the marks — the same value when it has nothing new or no story — or why a milestone
 *   cannot be placed on it
 */
export function applyMarks({
  aggregate,
  marks,
  mintId,
}: {
  aggregate: WorkstreamAggregate;
  marks: Marks;
  mintId: () => string;
}): Result<WorkstreamAggregate, WorkstreamInvalidError> {
  if (!takesNotes({ workstream: aggregate })) {
    return ok(aggregate);
  }
  const said = new Set(aggregate.entries.map((one) => notePhrasing({ text: one.text })));
  const notes = marks.notes.filter((one) => {
    const phrased = notePhrasing({ text: one.text });
    const fresh = !said.has(phrased);
    said.add(phrased);
    return fresh;
  });
  const anchored = new Set(aggregate.milestones.map((one) => one.anchor));
  const milestones = takesMilestones({ workstream: aggregate })
    ? marks.milestones.filter((one) => !anchored.has(one.anchor))
    : [];
  if (notes.length === 0 && milestones.length === 0) {
    return ok(aggregate);
  }
  let current: WorkstreamAggregate = {
    ...aggregate,
    entries: appendEntries({ entries: aggregate.entries, mintId, pending: notes }),
  };
  for (const milestone of milestones) {
    const placed = placeBeforeDone({ aggregate: current, milestone });
    if (placed.isErr()) {
      return err(placed.error);
    }
    current = placed.value;
  }
  return ok(current);
}

/**
 * The closing workstream a candidate the owner marked done becomes: kept, so "is it still holding?" has somewhere to be
 * asked, and so a done one stays on the page in its own lane rather than being dropped. It keeps what was mined — the
 * outcome, the cited evidence as its entries, the people owed a conversation — and closes on the day the owner said done,
 * the day the evidence knows of.
 *
 * @param id the register id it takes, already clear of every other
 * @param reason what made it done, in the owner's words, or `null`
 * @param mintId the fresh canonical UUID each entry takes
 * @returns the closing workstream
 */
export function closingFrom({
  candidate,
  id,
  mintId,
  nowIso,
  reason,
}: {
  candidate: Candidate;
  id: string;
  mintId: () => string;
  nowIso: string;
  reason: string | null;
}): WorkstreamAggregate {
  const day = nowIso.slice(0, 10);
  let state = `done — the owner marked it done on ${day}, from the mined candidates`;
  if (reason !== null) {
    state = `done — ${reason} (the owner marked it done on ${day}, from the mined candidates)`;
  }
  const pending = timelineFromCandidate({ candidate });
  // An evidence day is the owner's local day and `day` is UTC, so a word given in their morning can read as the day before
  // its own evidence; a completion never closes before what it cites.
  const latest = pending
    .map((entry) => entry.date)
    .toSorted()
    .at(-1);
  let closedOn = day;
  if (latest !== undefined && latest > day) {
    closedOn = latest;
  }
  const detail: ClosingWorkstreamDetail = {
    closedOn,
    ending: null,
    holding: "not yet asked — the Workstreams seat checks it is still holding",
    people: candidate.loopIn.map((one) => ({ part: one.why, slack: one.slack })),
    state,
  };
  return {
    detail,
    entries: appendEntries({ entries: [], mintId, pending }),
    id,
    kind: "closing",
    links: [],
    milestones: [],
    name: candidate.name,
    outcome: candidate.outcome,
    status: null,
    workspace: candidate.workspace,
  };
}
