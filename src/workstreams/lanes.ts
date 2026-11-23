/**
 * Whose move each workstream is, and the order the page lists them in: at risk first, so that workstreams are
 * less frequently dropped. Pure; `./store/projection.ts` stamps each workstream with what
 * this returns and sorts the document by it.
 */
import { PRIORITY_LEVELS } from "./schema.js";
import { typedWorkstreamDetail } from "./store/decode.js";
import type { WorkstreamAggregate } from "./store/types.js";

/**
 * Which lane a workstream is in, one each, naming whose move it is: the page's state filter, the colour-coded chip
 * on each card's left, and its hero numbers. The page filters by state (the blocked ones, the in-progress ones, all of them), and the chip says whether it is
 * blocked on the owner, needs a decision from them, or needs a chase to progress. Each carries the rule that puts a
 * workstream in it, so a hero number can say WHY it counts what it counts. Named `lane` rather than `state`
 * because a closing entry already carries a `state` sentence of its own.
 */
export const LANES = [
  { atRisk: true, id: "your-call", label: "Your call", rule: "held on a decision only you can make" },
  { atRisk: true, id: "chase", label: "Chase", rule: "held on someone named; it moves when we chase them" },
  {
    atRisk: true,
    id: "stalled",
    label: "Stalled",
    rule: "marked stalled with nobody named, so the next push is yours",
  },
  { atRisk: false, id: "discovery", label: "Discovery", rule: "no approach agreed yet, and nothing holding it" },
  { atRisk: false, id: "moving", label: "Moving", rule: "moving, with nothing holding it" },
  { atRisk: false, id: "done", label: "Done", rule: "finished or handed over" },
  {
    atRisk: false,
    id: "kept-here",
    label: "Kept here only",
    rule: "the means rather than an outcome, so no milestones",
  },
  {
    atRisk: false,
    id: "abandoned",
    label: "Abandoned",
    rule: "ended without its outcome; why is on the card, and it is never counted as done",
  },
] as const;

/** One of the lanes. */
type WorkstreamLane = (typeof LANES)[number]["id"];

/** One workstream, of any kind: what a lane is read from. */
type Entry = Pick<WorkstreamAggregate, "detail" | "id" | "kind" | "status">;

/** What every workstream carries beyond its register entry: its lane, and whether it is at risk of being dropped. */
export interface Standing {
  readonly lane: WorkstreamLane;
  /** Held on the owner, held on someone, or stalled: listed first, because these are the ones that get dropped. */
  readonly atRisk: boolean;
}

/**
 * A workstream's one lane. An ending outranks everything but a page-only kind: an abandoned workstream is nobody's
 * move and never done, whatever hold, status word or closing it was left carrying. Then whose move it is outranks its status word: "stalled" with a decision of
 * the owner's named is the owner's call, and with somebody named is a chase, which is the more useful thing to know.
 *
 * @returns the lane
 */
function laneOf({ one }: { one: Entry }): WorkstreamLane {
  const typed = typedWorkstreamDetail({ aggregate: one });
  if (typed.kind === "local") {
    return "kept-here";
  }
  if (typed.detail.ending !== null) {
    return "abandoned";
  }
  if (typed.kind === "closing") {
    return "done";
  }
  if (typed.detail.waitingOn !== null) {
    return typed.detail.waitingOn.on === "you" ? "your-call" : "chase";
  }
  if (typed.kind === "linked") {
    return "moving";
  }
  if (one.status === "stalled") {
    return "stalled";
  }
  if (one.status === "discovery") {
    return "discovery";
  }
  return "moving";
}

/**
 * A workstream's lane, and whether that lane is at risk.
 *
 * @returns its standing
 */
export function standingOf({ one }: { one: Entry }): Standing {
  const lane = laneOf({ one });
  return { atRisk: LANES.find((each) => each.id === lane)!.atRisk, lane };
}

/** Where a lane sorts: the owner's call, a chase, stalled, then live work, the means, what is done, and what was abandoned. */
const LANE_BAND: Readonly<Record<WorkstreamLane, number>> = {
  abandoned: 6,
  chase: 1,
  discovery: 3,
  done: 5,
  "kept-here": 4,
  moving: 3,
  stalled: 2,
  "your-call": 0,
};

/**
 * Where a priority sorts: the owner's levels in order, and "not stated" after `normal` and before `parked` — never ahead of
 * something called urgent, never behind something parked.
 *
 * @returns the band
 */
function priorityBand({ one }: { one: Entry }): number {
  const typed = typedWorkstreamDetail({ aggregate: one });
  if (typed.kind === "local" || typed.kind === "closing" || typed.detail.priority === null) {
    return PRIORITY_LEVELS.indexOf("normal") + 0.5;
  }
  return PRIORITY_LEVELS.indexOf(typed.detail.priority.level);
}

/**
 * The page's order: at risk first, then live work, the means, done, and abandoned; within each, the owner's priority; within
 * that, id order (a stable sort over the store's id-ordered read).
 *
 * @returns a new array
 */
export function inPageOrder<T extends Entry & Standing>({ workstreams }: { workstreams: readonly T[] }): T[] {
  return workstreams.toSorted(
    (a, b) => LANE_BAND[a.lane] - LANE_BAND[b.lane] || priorityBand({ one: a }) - priorityBand({ one: b }),
  );
}
