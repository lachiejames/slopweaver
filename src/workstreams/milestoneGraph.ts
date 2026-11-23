/**
 * A workstream's OWN milestones as a dependency graph: which can run in parallel, which wait on another, and where
 * each one is — every state read off the cited timeline, never typed.
 *
 * Folding ISO policy acceptance and the Auditco internal audit under the ISO
 * workstream, the milestones run in parallel rather than in a line, and some must happen in
 * order while other segments run in parallel, the way a pathfinding algorithm reads a dependency graph. So a
 * milestone names the ones it comes `after`, and this file lays the graph out in columns: a milestone's column is the
 * longest chain of predecessors before it, so two that can run side by side share a column and every edge runs left
 * to right.
 *
 * Pure: no I/O, no clock. The store judges the graph coherent on every write (`./store/validation.ts`), and the list
 * document attaches {@link deriveMilestoneGraph} to every workstream that carries milestones (`./store/projection.ts`).
 */
import type { WorkstreamEntry, WorkstreamMilestone } from "./store/types.js";

/**
 * Where one milestone is, from the entries that tag it:
 *
 * - `done`: an entry finished it, with the link that proves it.
 * - `moving`: entries tag it and none has finished it.
 * - `ready`: nothing yet, and every milestone it comes after is done, so it can start now.
 * - `waiting`: nothing yet, and a milestone it comes after is not done.
 */
type MilestoneState = "done" | "moving" | "ready" | "waiting";

/** One milestone as the page draws it. */
interface MilestoneNode {
  readonly id: string;
  readonly name: string;
  /** Where the owner named it. */
  readonly anchor: string;
  /** The ids it comes after, as the register declares them. */
  readonly after: readonly string[];
  readonly state: MilestoneState;
  /** The longest chain of predecessors before it: 0 for one that comes after nothing. */
  readonly column: number;
  /** The date of the first entry that tags it, or `null` before any does. */
  readonly startedOn: string | null;
  /** The date of the last entry that tags it, or `null` before any does. */
  readonly lastMovedOn: string | null;
  /** The date of the first entry that finished it, or `null` while it is not done. */
  readonly doneOn: string | null;
  /** The link that proves it done, or `null` while it is not. */
  readonly href: string | null;
  /** The names of the milestones it comes after that are not done yet, in declared order. */
  readonly waitingFor: readonly string[];
}

/** A workstream's milestone graph: its nodes in authored order, and how many columns they span. */
export interface MilestoneGraph {
  readonly columns: number;
  readonly milestones: readonly MilestoneNode[];
}

/**
 * Each milestone's column: the longest chain of predecessors before it.
 *
 * @returns the column per milestone id
 */
function columnsOf({ milestones }: { milestones: readonly WorkstreamMilestone[] }): ReadonlyMap<string, number> {
  const byId = new Map(milestones.map((one) => [one.id, one]));
  const columns = new Map<string, number>();
  const columnOf = ({ id }: { id: string }): number => {
    const known = columns.get(id);
    if (known !== undefined) {
      return known;
    }
    const one = byId.get(id);
    if (one === undefined) {
      throw new Error(`deriveMilestoneGraph: ${id} is not declared; the store refuses that workstream on write`);
    }
    // Set before recursing, so a cycle the cross-check missed ends rather than overflows the stack.
    columns.set(id, 0);
    const column = one.after.reduce((deepest, before) => Math.max(deepest, columnOf({ id: before }) + 1), 0);
    columns.set(id, column);
    return column;
  };
  for (const one of milestones) {
    columnOf({ id: one.id });
  }
  return columns;
}

/**
 * Where one milestone is: done once finished, moving once tagged, else ready or waiting on its predecessors.
 *
 * @param finished the first entry that finished it, if any
 * @param tagged whether any entry tags it
 * @param waitingFor the predecessors not yet done
 * @returns its state
 */
function stateOf({
  finished,
  tagged,
  waitingFor,
}: {
  finished: WorkstreamEntry | undefined;
  tagged: boolean;
  waitingFor: readonly string[];
}): MilestoneState {
  if (finished !== undefined) {
    return "done";
  }
  if (tagged) {
    return "moving";
  }
  return waitingFor.length === 0 ? "ready" : "waiting";
}

/**
 * Derive a workstream's milestone graph from what it declares and the entries that tag each milestone.
 *
 * @param milestones the declared milestones, as the store holds them
 * @param entries the workstream's dated entries, in any order
 * @returns each milestone's state, dates and column
 */
export function deriveMilestoneGraph({
  entries,
  milestones,
}: {
  entries: readonly WorkstreamEntry[];
  milestones: readonly WorkstreamMilestone[];
}): MilestoneGraph {
  const ordered = entries.toSorted((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  const authored = milestones.toSorted((a, b) => a.position - b.position);
  const byId = new Map(milestones.map((one) => [one.id, one]));
  const columns = columnsOf({ milestones });
  const done = new Map<string, WorkstreamEntry>();
  for (const entry of ordered) {
    if (entry.milestoneId !== null && entry.done && !done.has(entry.milestoneId)) {
      done.set(entry.milestoneId, entry);
    }
  }
  const nodes = authored.map((one): MilestoneNode => {
    const tagging = ordered.filter((entry) => entry.milestoneId === one.id);
    const finished = done.get(one.id);
    const waitingFor = one.after.flatMap((before) => {
      const other = byId.get(before);
      return other === undefined || done.has(before) ? [] : [other.name];
    });
    const first = tagging[0];
    const last = tagging.at(-1);
    return {
      after: one.after,
      anchor: one.anchor,
      column: columns.get(one.id)!,
      doneOn: finished === undefined ? null : finished.date,
      href: finished === undefined ? null : finished.href,
      id: one.id,
      lastMovedOn: last === undefined ? null : last.date,
      name: one.name,
      startedOn: first === undefined ? null : first.date,
      state: stateOf({ finished, tagged: tagging.length > 0, waitingFor }),
      waitingFor,
    };
  });
  const deepest = nodes.reduce((max, node) => Math.max(max, node.column + 1), 0);
  return { columns: deepest, milestones: nodes };
}
