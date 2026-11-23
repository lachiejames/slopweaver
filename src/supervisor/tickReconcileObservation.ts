/**
 * The board's source observation for a supervisor tick: what `handover reconcile` counted, and how many ready rows
 * it left with nobody on them — the one fact the Fleet page's history reads to tell "picking up more" from "nothing
 * ready" (`../fleet/stateHistory.ts`).
 *
 * Pure: it reads the reconcile slice `./tickDraftShapes.ts` parses, under the four rules `./tickDraftSources.ts`
 * states for every mapper.
 */
import type { z } from "zod";

import {
  documentWitness,
  observationOf,
  parseDocument,
  placedRowSlice,
  reconcileSlice,
  type SourceMapper,
} from "./tickDraftShapes.js";
import type { ReconcileFacts } from "./tickTypes.js";

/**
 * The ready rows no live seat is on, by the same rule the console's `openOrderOf` (`site/lib/fleetViews.ts`) draws
 * its Next list with — so a held tick's "nothing ready" and the page's Next list cannot disagree. Undefined, never
 * zero, when the reading did not observe the fleet, carries one id on two ready rows, predates `ready` or
 * `unprioritised`, or has a placement whose row id does not read.
 *
 * @param report the reconcile reading, as the tick's slice parsed it
 * @returns the count, or `undefined` when the reading cannot support one
 */
export function openReadyCountOf({ report }: { report: z.infer<typeof reconcileSlice> }): number | undefined {
  if (report.fleet !== "observed" || report.ready === undefined || report.unprioritised === undefined) {
    return undefined;
  }
  const readyIds = report.ready.map((row) => row.id);
  if (new Set(readyIds).size !== readyIds.length) {
    return undefined;
  }
  const seatedIds = new Set<string>();
  for (const placed of [...report.aligned, ...report.misaligned, ...report.unprioritised]) {
    const parsed = placedRowSlice.safeParse(placed);
    if (!parsed.success) {
      return undefined;
    }
    seatedIds.add(parsed.data.row.id);
  }
  return readyIds.filter((id) => !seatedIds.has(id)).length;
}

/**
 * The board: five counts, the open-ready count where it reads, and the two generated sentences, verbatim.
 *
 * @returns the board's observation, or the refusal a capture of the wrong shape earns
 */
export const reconcileObservation: SourceMapper<ReconcileFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "reconcile", schema: reconcileSlice }).map((report) => {
    const openReadyCount = openReadyCountOf({ report });
    return observationOf({
      facts: {
        alignedCount: report.aligned.length,
        headline: report.headline,
        intakeClause: report.intakeClause,
        misalignedCount: report.misaligned.length,
        ...(openReadyCount === undefined ? {} : { openReadyCount }),
        rankedCount: report.rankedCount,
        staleAskCount: report.staleAsks.length,
        starvingCount: report.starving.length,
        unregisteredCount: report.unregistered.length,
      },
      notes: [],
      observedAtIso: frame.capturedIso,
      verbatimLine: report.headline,
      witness: documentWitness({ dated: false, kind: "reconcile", path: capture.path }),
    });
  });
