/**
 * One pass over the registry: call each kind, build the file it learned, and total what happened.
 *
 * This is the stage that drives the pass. Every external call arrives through
 * {@link DatadogApiPassDeps}, so a test drives the real thing with plain injected functions and no mock. It
 * stands on `./syncApiEntities.ts` for the projection and `./syncApiGaps.ts` for the remainders rather than
 * re-deriving either, and neither of those imports it back.
 */

import { err, ok, type Result } from "../../lib/result.js";
import {
  DATADOG_API_FANOUT_DEFERRED,
  DATADOG_API_SHAPE_INDEX_DEFERRED,
  datadogApiAdmittedByKind,
  datadogApiFanoutDeferredByKind,
  datadogApiRowsFor,
  datadogApiShapeIndexDeferredByKind,
} from "./apiAcquisition.js";
import { DATADOG_API_CHANNEL, datadogApiCellFor, datadogApiTally } from "./apiCoverage.js";
import type { DatadogCoverageCell, DatadogKindFile } from "./documents.js";
import { mergeDatadogChannel } from "./merge.js";
import { DATADOG_REGISTRY_KINDS, type DatadogKind } from "./model.js";
import { projectDatadogValue } from "./projection.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";
import { entityFor, estateFor } from "./syncApiEntities.js";
import { kindGapsFor } from "./syncApiGaps.js";
import type {
  DatadogApiKindOutcome,
  DatadogApiOperationOutcome,
  DatadogApiPassDeps,
  DatadogApiSyncOutcome,
} from "./syncApiTypes.js";

/**
 * Issue one kind's admitted operations, in registry order.
 *
 * Sequential rather than concurrent, and that is the metered budget rather than simplicity: Datadog meters
 * per endpoint family and answers 429 with the seconds until that family refills, so a burst buys a wait
 * the transport then has to serve anyway. `rateLimit.ts` carries the measurement.
 *
 * @param rows this kind's admitted operations
 * @param kind the atlas kind, which fixes the field-denial scope for every body
 * @param call the injected transport
 * @returns one outcome per row, in registry order
 */
async function callKind({
  rows,
  kind,
  call,
}: {
  rows: readonly DatadogSurfaceRow[];
  kind: DatadogKind;
  call: DatadogApiPassDeps["call"];
}): Promise<readonly DatadogApiOperationOutcome[]> {
  const outcomes: DatadogApiOperationOutcome[] = [];
  for (const row of rows) {
    const answered = await call({ row });
    if (answered.isErr()) {
      outcomes.push({ error: answered.error, observation: null, projection: null, row });
      continue;
    }
    // Every byte crosses the storage boundary under this kind's own denial rules, before anything is held.
    const projection = projectDatadogValue({ kind, value: answered.value.bodies });
    outcomes.push({ error: null, observation: answered.value, projection, row });
  }
  return outcomes;
}

/**
 * One kind's next file: the `api` channel merged on, its cell replaced, its gaps reconciled.
 *
 * Both KINDS of `api` entity go onto that channel in one merge — the operations this pass called, and, for
 * the three kinds `estateAcquisition.ts` names, this organisation's own records exploded out of the list
 * operation's own answer. One merge rather than two, because `mergeDatadogChannel` stales every stored
 * entity it does not see on the channel it is refreshing: merging the two groups separately would have the
 * second pass stale everything the first had just written.
 */
function kindFileFor({
  kind,
  stored,
  outcomes,
  fanout,
  shapeIndex,
  at,
  scope,
}: {
  kind: DatadogKind;
  stored: DatadogKindFile;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout: readonly DatadogSurfaceRow[];
  shapeIndex: readonly DatadogSurfaceRow[];
  at: string;
  scope: string;
}): Result<{ file: DatadogKindFile; records: number; unidentified: number }> {
  const estate = estateFor({ at, kind, outcomes, scope });
  if (estate.isErr()) {
    return err(estate.error);
  }
  const observed = [
    ...outcomes.flatMap((outcome) => {
      const entity = entityFor({ at, kind, outcome, scope });
      return entity === null ? [] : [entity];
    }),
    ...estate.value.entities,
  ];
  const merged = mergeDatadogChannel({ at, channel: "api", observed, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = kindGapsFor({ at, fanout, kind, outcomes, shapeIndex, stored });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    file: {
      ...stored,
      coverage: [
        ...apiCoverageFor({
          at,
          estateRecords: estate.value.records,
          fanout: fanout.length,
          kind,
          outcomes,
          shapeIndex: shapeIndex.length,
          stored,
        }),
      ],
      entities: [...merged.value],
      gaps: [...gaps.value],
      updatedAt: at,
    },
    records: estate.value.records,
    unidentified: estate.value.unidentified,
  });
}

/**
 * This kind's coverage cells with the `api` one replaced and the other two channels' left exactly as they are.
 *
 * Filtering on `surface` rather than rebuilding the list is what makes three channels able to write three
 * cells into one kind file — `coverage.ts`'s header carries why the cell's `surface` is the CHANNEL.
 */
function apiCoverageFor({
  at,
  estateRecords,
  fanout,
  kind,
  outcomes,
  shapeIndex,
  stored,
}: {
  at: string;
  estateRecords: number;
  fanout: number;
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  shapeIndex: number;
  stored: DatadogKindFile;
}): readonly DatadogCoverageCell[] {
  // Absent on the first live pass over a kind, present on every one after. Read into a name, and returned
  // by an `if`, because it is what carries an earlier success forward when today's read fails — and because
  // the house rule bans `??` here while oxlint rewrites the ternary that replaces it straight back into one.
  const held = stored.coverage.find((cell) => cell.surface === DATADOG_API_CHANNEL);
  const previous = heldOrNone({ held });
  return [
    ...stored.coverage.filter((cell) => cell.surface !== DATADOG_API_CHANNEL),
    datadogApiCellFor({ at, estateRecords, fanout, kind, outcomes, previous, shapeIndex }),
  ];
}

/** The stored cell, or `null` when this kind has never carried one. */
function heldOrNone({ held }: { held: DatadogCoverageCell | undefined }): DatadogCoverageCell | null {
  if (held === undefined) {
    return null;
  }
  return held;
}

/**
 * Run the live pass over every kind and return the files it would publish.
 *
 * Separated from publishing so the whole pass is exercisable against an injected transport with no temp
 * directory and no ambient home — the same split `sync.ts` makes, and for the same reason.
 *
 * @param stored every kind file the store already holds, keyed by kind
 * @param deps the transport, the clock, the scope and the progress sink
 * @returns the next files and what the pass did, or the first reason a kind could not be merged
 */
export async function runDatadogApiPass({
  stored,
  deps,
}: {
  stored: Readonly<Partial<Record<DatadogKind, DatadogKindFile | null>>>;
  deps: DatadogApiPassDeps;
}): Promise<
  Result<{
    files: Partial<Record<DatadogKind, DatadogKindFile>>;
    outcome: Omit<DatadogApiSyncOutcome, "written">;
  }>
> {
  const admitted = datadogApiAdmittedByKind();
  const fanoutByKind = datadogApiFanoutDeferredByKind();
  const shapeByKind = datadogApiShapeIndexDeferredByKind();
  const files: Partial<Record<DatadogKind, DatadogKindFile>> = {};
  const kinds: DatadogApiKindOutcome[] = [];
  for (const kind of DATADOG_REGISTRY_KINDS) {
    const rows = datadogApiRowsFor({ byKind: admitted, kind });
    const held = stored[kind];
    if (held === undefined || held === null) {
      // Nothing to merge onto. `sync.ts` publishes every kind before this pass can run, so a missing file
      // means the compiled generation was never published — which `syncDatadogApi` refuses before reaching
      // here, and which this skip makes non-destructive if that guard is ever moved.
      continue;
    }
    const outcomes = await callKind({ call: deps.call, kind, rows });
    const counts = datadogApiTally({ outcomes });
    deps.onProgress?.({
      line: `${kind}: ${String(counts.answered)}/${String(rows.length)} answered, ${String(counts.failed)} failed, ${String(counts.firstPageOnly)} first-page-only, ${String(counts.specNamesOnly)} admitted on spec names only`,
    });
    const next = kindFileFor({
      at: deps.at,
      fanout: datadogApiRowsFor({ byKind: fanoutByKind, kind }),
      kind,
      outcomes,
      scope: deps.scope,
      shapeIndex: datadogApiRowsFor({ byKind: shapeByKind, kind }),
      stored: held,
    });
    if (next.isErr()) {
      return err(next.error);
    }
    files[kind] = next.value.file;
    if (next.value.records > 0 || next.value.unidentified > 0) {
      deps.onProgress?.({
        line: `${kind}: ${String(next.value.records)} of this organisation's own record(s) stored, ${String(next.value.unidentified)} entry(ies) carried no id`,
      });
    }
    kinds.push({
      kind,
      ...counts,
      estateRecords: next.value.records,
      estateUnidentified: next.value.unidentified,
    });
  }
  return ok({ files, outcome: passTotals({ kinds, scope: deps.scope }) });
}

/** The pass's own totals, summed from the per-kind rows rather than counted a second time. */
function passTotals({
  kinds,
  scope,
}: {
  kinds: readonly DatadogApiKindOutcome[];
  scope: string;
}): Omit<DatadogApiSyncOutcome, "written"> {
  const sum = ({ pick }: { pick: (one: DatadogApiKindOutcome) => number }): number =>
    kinds.reduce((total, one) => total + pick(one), 0);
  return {
    answered: sum({ pick: (one) => one.answered }),
    attempted: sum({ pick: (one) => one.attempted }),
    estateRecords: sum({ pick: (one) => one.estateRecords }),
    failed: sum({ pick: (one) => one.failed }),
    fanoutDeferred: DATADOG_API_FANOUT_DEFERRED.length,
    firstPageOnly: sum({ pick: (one) => one.firstPageOnly }),
    kinds,
    scope,
    shapeIndexDeferred: DATADOG_API_SHAPE_INDEX_DEFERRED.length,
    specNamesOnly: sum({ pick: (one) => one.specNamesOnly }),
  };
}
