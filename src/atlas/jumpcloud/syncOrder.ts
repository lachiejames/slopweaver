/**
 * The order and the bindings of the walk's calls: which ids one fan-out is bound from, and how one phase's
 * calls interleave across kinds.
 *
 * Split out of `syncEngine.ts`, which makes, journals and schedules the calls and explains why both rules
 * hold: this half is pure, so it is read, and tested, without a client, a clock or a journal.
 */
import type { JumpcloudOperation } from "./plan.js";
import type { JumpcloudAccumulator } from "./syncAccumulator.js";

/**
 * The ids one fan-out is bound from — its parent collection's, or the kind's pool when it has no parent.
 *
 * A parent that was PLANNED and yielded nothing is a different fact from a fan-out with no parent at all,
 * and the two must not collapse: the first is an empty family and its fan-out correctly makes no call, the
 * second is the fallback `plan.ts` documents. Naming the absent case is what keeps them apart.
 *
 * @param root the parent collection {@link bindingRootFor} chose, or `null` when none is its parent
 * @param accumulator the kind's accumulator, holding what each root yielded
 * @param pooled every root's ids together, the fallback
 * @returns the ids to bind, deduplicated and sorted
 */
export function idsForFanout({
  root,
  accumulator,
  pooled,
}: {
  root: JumpcloudOperation | null;
  accumulator: JumpcloudAccumulator;
  pooled: readonly string[];
}): readonly string[] {
  if (root === null) {
    return pooled;
  }
  const fromParent = accumulator.providerIdsBySurface[root.row.name];
  if (fromParent === undefined) {
    return [];
  }
  return [...new Set(fromParent)].toSorted();
}

/**
 * One phase's calls, interleaved across kinds so no kind's epoch is a narrow window inside the run.
 *
 * @param perKind each kind's own ordered calls
 * @returns the calls, round-robin by slot then by kind
 */
export function interleave<TCall>({ perKind }: { perKind: readonly (readonly TCall[])[] }): readonly TCall[] {
  const longest = perKind.reduce((most, calls) => Math.max(most, calls.length), 0);
  const ordered: TCall[] = [];
  for (let slot = 0; slot < longest; slot += 1) {
    for (const calls of perKind) {
      const call = calls[slot];
      if (call !== undefined) {
        ordered.push(call);
      }
    }
  }
  return ordered;
}
