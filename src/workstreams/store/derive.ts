/**
 * Where a workstream stands against its own milestones, derived from its dated entries on every read and never
 * stored, so a progress figure cannot drift from the proof that earns it.
 *
 * A milestone is done when an entry finishes it (`done`, with its proof link — `./validation.ts` holds that rule).
 * The milestones ready to start are the incomplete ones whose every predecessor is done; the next is the first of
 * those in authored order. The workstream is complete once its definition of done — the last milestone — is done.
 * There is no generic bar: the line reads the workstream's own milestones and nothing else.
 *
 * Pure.
 */
import type { WorkstreamAggregate, WorkstreamProgress } from "./types.js";
import { definitionOfDone } from "./validation.js";

/**
 * Derive a workstream's progress from its milestones and entries.
 *
 * @param aggregate a workstream that passed `aggregateProblems`
 * @returns its progress, or `null` for a kind that carries no milestones (`local`, `closing`)
 */
export function deriveWorkstreamProgress({
  aggregate,
}: {
  aggregate: Pick<WorkstreamAggregate, "entries" | "milestones">;
}): WorkstreamProgress | null {
  const { entries, milestones } = aggregate;
  const last = definitionOfDone({ milestones });
  if (last === undefined) {
    return null;
  }
  const done = new Set(
    entries.flatMap((entry) => (entry.done && entry.milestoneId !== null ? [entry.milestoneId] : [])),
  );
  const ordered = milestones.toSorted((a, b) => a.position - b.position);
  const ready = ordered.filter((one) => !done.has(one.id) && one.after.every((before) => done.has(before)));
  const [first] = ready;
  const progress = {
    complete: done.has(last.id),
    doneCount: ordered.filter((one) => done.has(one.id)).length,
    ready,
    totalCount: ordered.length,
  };
  if (first === undefined) {
    return { ...progress, next: null };
  }
  return { ...progress, next: first };
}

/**
 * The one line a tile shows for a workstream's progress.
 *
 * @returns `"<done> of <total> done, next: <name>"`, or `"<total> of <total> done"` once complete
 */
export function workstreamProgressLine({ progress }: { progress: WorkstreamProgress }): string {
  const counted = `${progress.doneCount} of ${progress.totalCount} done`;
  if (progress.complete || progress.next === null) {
    return counted;
  }
  return `${counted}, next: ${progress.next.name}`;
}
