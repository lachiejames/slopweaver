/**
 * What one kind's pass did NOT reach, stated rather than implied.
 *
 * Four remainders stand after a live pass: the operations that page and kept only their first page, the answers
 * admitted against the specification's names alone, the ones that take an identifier no fan-out supplies, and the
 * shape-index operations deferred whole. The fan-out and shape-index sets are computed once in
 * `./apiAcquisition.ts` and read from there, and the first two are counted once in `./apiCoverage.ts`'s tally,
 * rather than re-derived here, because two independent derivations of one number is how a report begins
 * disagreeing with itself.
 *
 * Nothing here calls the API. It reads outcomes and returns gaps, so `./syncApiPass.ts` imports this module
 * and this module imports nothing of the pass.
 */

import type { Result } from "../../lib/result.js";
import { datadogApiTally } from "./apiCoverage.js";
import type { DatadogGap, DatadogKindFile } from "./documents.js";
import { type DatadogGapCondition, openDatadogGap, reconcileDatadogGaps } from "./gaps.js";
import type { DatadogKind } from "./model.js";
import { datadogPagingParametersFor } from "./pagingParameters.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";
import type { DatadogApiOperationOutcome } from "./syncApiTypes.js";

function apiGapsFor({
  kind,
  outcomes,
  fanout,
  shapeIndex,
  at,
}: {
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout: readonly DatadogSurfaceRow[];
  shapeIndex: readonly DatadogSurfaceRow[];
  at: string;
}): readonly DatadogGap[] {
  const counts = datadogApiTally({ outcomes });
  const open: readonly { condition: DatadogGapCondition; reason: () => string; when: boolean }[] = [
    {
      condition: "api-first-page-only",
      reason: () => firstPageReason({ count: counts.firstPageOnly, kind, outcomes }),
      when: counts.firstPageOnly > 0,
    },
    {
      condition: "api-response-boundary-unmeasured",
      reason: () =>
        `${String(counts.specNamesOnly)} answer(s) in \`${kind}\` were admitted by a boundary holding only the specification's field names and kinds, because no census had measured those operations answering — a renamed key is still refused, but every value under those names went unread. What closes this is a fresh census (\`tools/datadogResponseCensus.ts\`) and the boundaries regenerated from it, never a re-run of this pass`,
      when: counts.specNamesOnly > 0,
    },
    {
      condition: "api-fanout-unbuilt",
      reason: () => fanoutReason({ fanout, kind, reached: counts.answered }),
      when: fanout.length > 0,
    },
    {
      condition: "api-shape-index-unbuilt",
      reason: () =>
        `${String(shapeIndex.length)} operation(s) in \`${kind}\` are shape-index rather than entity, and the windowed pass that issues them is not built. They are NOT excluded: the owner's scope rule treats a voluminous family as a different treatment rather than a refusal, so this gap is what stands in for the index until one exists`,
      when: shapeIndex.length > 0,
    },
  ];
  return open
    .filter((one) => one.when)
    .map(({ condition, reason }) =>
      openDatadogGap({ at, channel: "api", condition, kind, reason: reason(), scope: kind }),
    );
}

/** The first-page gap names every walk parameter the kept-first-page operations page under, sorted. */
function firstPageReason({
  count,
  kind,
  outcomes,
}: {
  count: number;
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
}): string {
  const walking = outcomes.filter((one) => one.observation?.bound === "first-page");
  const named = [
    ...new Set(walking.map((one) => `\`${String(datadogPagingParametersFor({ surface: one.row.name }).walk)}\``)),
  ].toSorted();
  return `${String(count)} operation(s) in \`${kind}\` walk a collection and only their first page was kept. They page under ${named.join(", ")}, which the registry records per operation — so what closes this is a walk that sends that parameter, never a re-run of the first page`;
}

/** A kind reachable ONLY through identifiers has to say so in different words from a kind that was called. */
function fanoutReason({
  fanout,
  kind,
  reached,
}: {
  fanout: readonly DatadogSurfaceRow[];
  kind: DatadogKind;
  reached: number;
}): string {
  const head = `${String(fanout.length)} entity operation(s) in \`${kind}\` take an identifier in their path — for example \`${String(fanout[0]?.path)}\` — and the fan-out that would supply one from an already-stored entity is not built`;
  if (reached > 0) {
    return head;
  }
  return `${head}. EVERY entity operation in this kind is of that shape, so this pass made no call here at all: a reader must not take this kind's silence for an organisation that holds none of it`;
}

/**
 * One kind's gaps after this pass: what the fanout still leaves open, reconciled against what was stored.
 *
 * @param stored the kind file this pass started from, for its standing gaps
 * @returns the reconciled gap list, or the reconcile's own failure
 */
export function kindGapsFor({
  kind,
  stored,
  outcomes,
  fanout,
  shapeIndex,
  at,
}: {
  kind: DatadogKind;
  stored: DatadogKindFile;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout: readonly DatadogSurfaceRow[];
  shapeIndex: readonly DatadogSurfaceRow[];
  at: string;
}): Result<readonly DatadogGap[]> {
  return reconcileDatadogGaps({
    at,
    observed: apiGapsFor({ at, fanout, kind, outcomes, shapeIndex }),
    // `api-never-called` is rechecked, and RESOLVED, for every kind this pass issued a call in — whether or
    // not that call answered. The condition is exactly "nothing has asked this organisation", and once a
    // request has gone out that is no longer true; whether Datadog answered is a different fact and lives
    // on the coverage cell, which a 403 makes `unavailable` rather than silent. A kind this pass could make
    // no call in at all is deliberately NOT rechecked, so its gap stays open with its original reason.
    rechecks: outcomes.length === 0 ? [] : [{ condition: "api-never-called", resolved: true, scope: kind }],
    runFailed: false,
    stored: stored.gaps,
  });
}
