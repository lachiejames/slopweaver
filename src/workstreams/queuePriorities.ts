/**
 * The owner's priorities as the board's reconcile reads them: the `workstream=` tag values their `urgent` workstreams
 * name, the first priority first — the same set and order `site/lib/queueFocus.ts` `queueFocuses` lifts on the Queue, so the
 * board and the Queue lead with one list (`src/waiting/queueOrder.ts`).
 *
 * A priority is a live outcome, standing or linked workstream at `urgent` that states `queueWorkstream` and has no
 * `ending`; its `rank` orders it, 1 first, an unranked one after every ranked one, ties in the order given.
 *
 * Pure: the store's workstreams in, tag values out.
 */
import { rankQueue } from "../waiting/queueOrder.js";

import { typedWorkstreamDetail } from "./store/decode.js";
import type { WorkstreamAggregate } from "./store/types.js";

/**
 * The tag values of the owner's priorities, the first priority first.
 *
 * @param workstreams every workstream the store holds
 * @returns the `workstream=` values, in priority order
 */
export function queuePriorities({ workstreams }: { workstreams: readonly WorkstreamAggregate[] }): readonly string[] {
  const ranked = workstreams.flatMap((aggregate): { rank: number | undefined; value: string }[] => {
    const typed = typedWorkstreamDetail({ aggregate });
    if (typed.kind === "local" || typed.kind === "closing" || typed.detail.ending !== null) {
      return [];
    }
    const { priority, queueWorkstream } = typed.detail;
    if (priority?.level !== "urgent" || queueWorkstream === undefined) {
      return [];
    }
    return [{ rank: priority.rank, value: queueWorkstream }];
  });
  return rankQueue({
    factOf: (entry) =>
      entry.rank === undefined ? { band: "priority" } : { band: "priority", priorityRank: entry.rank },
    items: ranked,
  }).map((entry) => entry.value);
}
