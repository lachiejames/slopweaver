/**
 * The reactions ledger, folded: the latest row per candidate stands, so the owner can change their mind, and the latest
 * promotion is remembered, so a later word never loses the tile a yes made. Pure.
 */
import type { Reaction, ReactionRow, ReactionVia } from "./candidates.js";

/** A candidate's standing reaction, and the register entry any yes of the owner's made of it. */
export interface CandidateState {
  readonly reaction: Reaction | null;
  readonly reactedIso: string | null;
  readonly via: ReactionVia | null;
  /** The owner's words on the standing reaction, when the row kept them. */
  readonly heard: string | null;
  /** The register id the most recent promoting yes wrote, whatever the owner said after it. */
  readonly promotedAs: string | null;
  /** The standing row's own why, the workstream it is the same as, whose it is and what covers it. */
  readonly reason: string | null;
  readonly sameAs: string | null;
  readonly milestoneOf: string | null;
  readonly outcomeOf: string | null;
  readonly supersededBy: string | null;
  readonly owner: string | null;
  readonly coveredBy: string | null;
  readonly steer: string | null;
}

/**
 * Fold the reactions ledger: the latest row per candidate stands, and the latest promotion is remembered.
 *
 * @param rows every reactions.jsonl row, in file order
 * @returns each candidate id that has a row, and its state
 */
export function latestReactions({ rows }: { rows: readonly ReactionRow[] }): ReadonlyMap<string, CandidateState> {
  const states = new Map<string, CandidateState>();
  for (const row of rows) {
    const before = states.get(row.candidate);
    let promotedAs: string | null = null;
    if (row.promotedAs !== null) {
      promotedAs = row.promotedAs;
    } else if (before !== undefined) {
      promotedAs = before.promotedAs;
    }
    states.set(row.candidate, {
      coveredBy: row.coveredBy,
      heard: row.heard,
      milestoneOf: row.milestoneOf,
      outcomeOf: row.outcomeOf,
      owner: row.owner,
      promotedAs,
      reactedIso: row.iso,
      reaction: row.reaction,
      reason: row.reason,
      sameAs: row.sameAs,
      steer: row.steer,
      supersededBy: row.supersededBy,
      via: row.via,
    });
  }
  return states;
}

/**
 * Whether a row's word places the candidate against a named workstream, the one kind of word that re-homes it
 * (`./placePick.ts`'s `placeAgainst`).
 *
 * @param row one reaction row
 * @returns whether it names where the candidate now belongs
 */
function placesAgainst({ row }: { row: ReactionRow }): boolean {
  if (row.reaction === "no") {
    return row.coveredBy !== null;
  }
  return row.reaction === "same-as" || row.reaction === "milestone-of" || row.reaction === "outcome-of";
}

/**
 * A candidate's latest state as `heldAs` (`./promotion.ts`) judges whether the register already holds it: the
 * owner's same-as stands until a later word places the candidate somewhere else, so a yes or an ending on top of it still
 * names the workstream that same-as did. Without it, the row a failed write left behind reads as unheld on the retry,
 * and the identical word promotes a second workstream rather than acting on the one it meant — a yes or an abandon.
 *
 * @param held every reaction row recorded so far, in order
 * @param states the latest state per candidate, folded from `held`
 * @returns the state, its same-as carried through every word on top of it that placed it nowhere else
 */
export function standingState({
  candidateId,
  held,
  states,
}: {
  candidateId: string;
  held: readonly ReactionRow[];
  states: ReadonlyMap<string, CandidateState>;
}): CandidateState | undefined {
  const state = states.get(candidateId);
  if (state === undefined || state.sameAs !== null) {
    return state;
  }
  const placing = held.findLast((row) => row.candidate === candidateId && placesAgainst({ row }));
  const placedAs = placing?.sameAs;
  if (placedAs == null) {
    return state;
  }
  return { ...state, sameAs: placedAs };
}
