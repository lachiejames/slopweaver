/**
 * The document `slopweaver workstreams list --json` prints and `workstreams put --file` takes back: schema version 2,
 * every workstream exactly as the store holds it, each with what is DERIVED for it under `derived`, and the
 * register's `baseline`.
 *
 * A workstream carries its own
 * milestones, the last its definition of done, and progress is read off them, never a generic bar. So there is no
 * bar, phase or percentage here: `derived.progress` is `./derive.ts`'s count against the workstream's own milestones.
 *
 * ## Authored and derived, kept apart
 *
 * Every field outside `derived` is the stored aggregate, child UUIDs included, so a person edits the document and
 * hands it back whole. `derived` is a function of those fields and is ignored on the way back in, so nothing a
 * reader computed can be written as though it were authored.
 *
 * ## The baseline travels with the document
 *
 * `baseline` (`./baseline.ts`) names the content this document was read at. `workstreams put` judges the store against
 * the document's own baseline, never a fresh one, so a document edited against a register that has since moved is
 * refused rather than written over what its author never saw.
 *
 * Pure.
 */
import { inPageOrder, LANES, type Standing, standingOf } from "../lanes.js";
import { deriveMilestoneGraph, type MilestoneGraph } from "../milestoneGraph.js";
import { PRIORITY_LEVELS } from "../schema.js";

import { snapshotBaseline } from "./baseline.js";
import { typedWorkstreamDetail } from "./decode.js";
import { deriveWorkstreamProgress, workstreamProgressLine } from "./derive.js";
import type {
  StoredWorkstream,
  WorkstreamAggregate,
  WorkstreamProgress,
  WorkstreamRegisterMeta,
  WorkstreamRegisterSnapshot,
} from "./types.js";

/** A linked workstream's gauge as shares of its whole, so the page draws it without arithmetic of its own. */
interface GaugeReading {
  readonly share: number;
  readonly gateShare: number;
  /** How many short of the gate, never negative. */
  readonly short: number;
}

/** What is derived for one workstream: never stored, never read back in. */
interface DerivedStanding extends Standing {
  /** Against its own milestones; `null` for a kind that carries none (`local`, `closing`). */
  readonly progress: WorkstreamProgress | null;
  /** The one line a tile shows for `progress`, or `null` with it. */
  readonly progressLine: string | null;
  /** The earliest dated entry's day, or `null` before the story has one. */
  readonly startedOn: string | null;
  /** The latest dated entry's day, or `null` before the story has one. */
  readonly lastMovedOn: string | null;
  /** A linked workstream's gauge reading; `null` for every other kind. */
  readonly gauge: GaugeReading | null;
  /** Its own milestones laid out as the page draws them (`../milestoneGraph.ts`); `null` with `progress`. */
  readonly milestoneGraph: MilestoneGraph | null;
}

/** One workstream as the document carries it: the stored aggregate, and what was derived for it. */
export type ProjectedWorkstream = WorkstreamAggregate & { readonly derived: DerivedStanding };

/** The document `workstreams list --json` prints. */
export interface WorkstreamsDocument {
  readonly schemaVersion: 2;
  /** The content this was read at; `workstreams put` refuses a register that has moved since. */
  readonly baseline: string;
  /** The register-level document — channel words, grouping, initiatives — or `null` before one is written. */
  readonly meta: WorkstreamRegisterMeta | null;
  readonly lanes: typeof LANES;
  readonly priorities: typeof PRIORITY_LEVELS;
  /** Every workstream in the page's order: at risk first, then by the owner's priority, then by id. */
  readonly workstreams: readonly ProjectedWorkstream[];
}

/**
 * The authored aggregate of a stored workstream: what the store minted and derived left out.
 *
 * @returns the aggregate
 */
export function authoredAggregate({ stored }: { stored: WorkstreamAggregate }): WorkstreamAggregate {
  const { detail, entries, id, kind, links, milestones, name, outcome, status, workspace } = stored;
  return { detail, entries, id, kind, links, milestones, name, outcome, status, workspace };
}

/**
 * The gauge reading of a linked workstream.
 *
 * @returns the shares and how far short of the gate it is, or `null` for any other kind
 */
function gaugeOf({ aggregate }: { aggregate: WorkstreamAggregate }): GaugeReading | null {
  const typed = typedWorkstreamDetail({ aggregate });
  if (typed.kind !== "linked") {
    return null;
  }
  const { gate, of, value } = typed.detail.gauge;
  return { gateShare: gate / of, share: value / of, short: Math.max(gate - value, 0) };
}

/**
 * Derive one workstream's standing.
 *
 * @returns what the page shows beside its authored fields
 */
function deriveStanding({ aggregate }: { aggregate: WorkstreamAggregate }): DerivedStanding {
  const progress = deriveWorkstreamProgress({ aggregate });
  const dates = aggregate.entries.map((entry) => entry.date).toSorted();
  // An empty story has neither day, which the page shows as a dash rather than a date.
  let startedOn: string | null = null;
  let lastMovedOn: string | null = null;
  const [first] = dates;
  const last = dates.at(-1);
  if (first !== undefined && last !== undefined) {
    startedOn = first;
    lastMovedOn = last;
  }
  return {
    ...standingOf({ one: aggregate }),
    gauge: gaugeOf({ aggregate }),
    lastMovedOn,
    milestoneGraph:
      progress === null ? null : deriveMilestoneGraph({ entries: aggregate.entries, milestones: aggregate.milestones }),
    progress,
    progressLine: progress === null ? null : workstreamProgressLine({ progress }),
    startedOn,
  };
}

/**
 * The whole document, from one read of the store.
 *
 * @param snapshot what the store returned
 * @returns every workstream, authored and derived, in the page's order, with the register's baseline
 */
export function projectRegister({ snapshot }: { snapshot: WorkstreamRegisterSnapshot }): WorkstreamsDocument {
  // Each carries its lane and risk at the top only while it is sorted; the document keeps them under `derived`.
  const sortable = snapshot.workstreams.map((stored: StoredWorkstream) => {
    const aggregate = authoredAggregate({ stored });
    const derived = deriveStanding({ aggregate });
    return { ...aggregate, atRisk: derived.atRisk, derived, lane: derived.lane };
  });
  return {
    baseline: snapshotBaseline({ snapshot }),
    lanes: LANES,
    meta: snapshot.meta === null ? null : snapshot.meta.document,
    priorities: PRIORITY_LEVELS,
    schemaVersion: 2,
    workstreams: inPageOrder({ workstreams: sortable }).map(
      ({ atRisk: _atRisk, lane: _lane, ...one }): ProjectedWorkstream => one,
    ),
  };
}

/**
 * Every Slack member id the register names as a person involved, once each, in id order of their workstreams — what
 * the list verb joins to the member roster so the page can draw identity chips.
 *
 * @returns the ids
 */
export function memberIds({ workstreams }: { workstreams: readonly WorkstreamAggregate[] }): readonly string[] {
  const ids = new Set<string>();
  for (const aggregate of workstreams) {
    const typed = typedWorkstreamDetail({ aggregate });
    if (typed.kind === "local") {
      continue;
    }
    for (const person of typed.detail.people) {
      ids.add(person.slack);
    }
  }
  return [...ids];
}
