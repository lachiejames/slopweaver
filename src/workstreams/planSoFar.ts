/**
 * What a batch of the owner's reactions has planned so far — the accumulator `./placePick.ts` adds each pick's placement to
 * and `./promotion.ts` reads the finished plan out of.
 *
 * Pure.
 */

import type { Reaction, ReactionRow } from "./candidates.js";
import type { PendingEntry } from "./candidateTile.js";
import type { PendingMilestone } from "./placement.js";
import type { OwnWorkstreamDetail } from "./store/decode.js";
import type { WorkstreamAggregate } from "./store/types.js";

/** How a workstream ended short of its outcome: the `ending` its detail carries. */
export type Ending = NonNullable<OwnWorkstreamDetail["ending"]>;

/** A candidate and the register id it became, or was already held under. */
export interface HeldUnder {
  readonly candidate: string;
  readonly as: string;
}

/** The placement fields one row records: each only on the word it belongs to, `null` on every other. */
export type RowFields = Pick<
  ReactionRow,
  "coveredBy" | "milestoneOf" | "outcomeOf" | "owner" | "reason" | "sameAs" | "steer" | "supersededBy"
>;

/** What a batch's plan has gathered so far, added to pick by pick, with every id a new workstream may not take. */
export interface PlanSoFar {
  readonly added: WorkstreamAggregate[];
  readonly updated: Map<string, WorkstreamAggregate>;
  readonly marks: Map<string, { notes: PendingEntry[]; milestones: PendingMilestone[] }>;
  readonly placed: (HeldUnder & { readonly word: Reaction })[];
  readonly alreadyHeld: HeldUnder[];
  readonly ended: HeldUnder[];
  readonly endings: Map<string, Ending>;
  readonly promoted: HeldUnder[];
  readonly taken: Set<string>;
}

/**
 * A plan with nothing placed yet, every id the register holds already taken.
 *
 * @param workstreams every workstream the register holds
 * @returns the plan to add to
 */
export function emptyPlan({ workstreams }: { workstreams: readonly Pick<WorkstreamAggregate, "id">[] }): PlanSoFar {
  const taken = new Set(workstreams.map((one) => one.id));
  return {
    added: [],
    alreadyHeld: [],
    ended: [],
    endings: new Map(),
    marks: new Map(),
    placed: [],
    promoted: [],
    taken,
    updated: new Map(),
  };
}

/**
 * The marks gathered for one workstream, started empty the first time.
 *
 * @returns the workstream's marks, to add to
 */
export function marksOn({ id, so }: { id: string; so: PlanSoFar }): {
  notes: PendingEntry[];
  milestones: PendingMilestone[];
} {
  const standing = so.marks.get(id);
  if (standing !== undefined) {
    return standing;
  }
  const fresh = { milestones: [], notes: [] };
  so.marks.set(id, fresh);
  return fresh;
}
