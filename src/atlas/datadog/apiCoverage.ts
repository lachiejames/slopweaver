/**
 * Turning one kind's operation outcomes into its `api` COVERAGE CELL — the verdict, and the sentences under it.
 *
 * Split from `syncApi.ts` along the seam the pass already had: that module ISSUES and PUBLISHES, this one
 * JUDGES. The judgement is the part with no I/O in it and the part a reviewer has to hold whole, because it
 * is where an atlas either claims what it earned or claims more — `coverage.ts`'s header carries the 18
 * kinds that once published `synced` having asked nothing.
 */

import { type DatadogReadOutcome, datadogCoverageCell, storedDatadogCoverageCell } from "./coverage.js";
import type { DatadogCoverageCell } from "./documents.js";
import type { DatadogAtlasError } from "./errors.js";
import { datadogEstateRowFor } from "./estateAcquisition.js";
import { DATADOG_VISIBILITY_SCOPE, type DatadogKind } from "./model.js";
import type { DatadogApiOperationOutcome } from "./syncApiTypes.js";

/** The channel this module judges, named once so a caller cannot pass a different one. */
export const DATADOG_API_CHANNEL = "api";

/** One kind's counts, as the cell, the gap and the progress line all read them. */
export interface DatadogApiTally {
  readonly answered: number;
  readonly attempted: number;
  readonly failed: number;
  readonly firstPageOnly: number;
  /** Answers admitted by a boundary declaring the specification's names alone, so their values went unread. */
  readonly specNamesOnly: number;
}

/**
 * The counts a kind's cell, gap and progress line all read, derived once.
 *
 * @param outcomes this kind's operation results, answered and failed alike
 * @returns how many were attempted, answered, failed, kept only a first page, and admitted on names alone
 */
export function datadogApiTally({ outcomes }: { outcomes: readonly DatadogApiOperationOutcome[] }): DatadogApiTally {
  let answered = 0;
  let failed = 0;
  let firstPageOnly = 0;
  let specNamesOnly = 0;
  for (const outcome of outcomes) {
    if (outcome.observation === null) {
      failed += 1;
      continue;
    }
    answered += 1;
    if (outcome.observation.bound === "first-page") {
      firstPageOnly += 1;
    }
    if (outcome.observation.boundarySource === "spec-names-only") {
      specNamesOnly += 1;
    }
  }
  return { answered, attempted: outcomes.length, failed, firstPageOnly, specNamesOnly };
}

/** What bounds this kind's read, as the sentence the cell carries. */
function boundedBecause({
  counts,
  fanout,
  shapeIndex,
}: {
  counts: { firstPageOnly: number; specNamesOnly: number };
  fanout: number;
  shapeIndex: number;
}): string {
  const parts: string[] = [];
  if (counts.firstPageOnly > 0) {
    parts.push(
      `${String(counts.firstPageOnly)} of them page and only their FIRST page was kept — the walk that follows a Datadog cursor is not built, and this pass will not guess where one lives in a response body`,
    );
  }
  if (counts.specNamesOnly > 0) {
    parts.push(
      `${String(counts.specNamesOnly)} answer(s) were admitted by a boundary holding only the specification's field names and kinds, every value under them unread, because no census had measured that operation answering`,
    );
  }
  if (fanout > 0) {
    parts.push(
      `${String(fanout)} further entity operation(s) in this kind take an identifier in their path, and the fan-out that would supply one from an already-stored entity does not exist`,
    );
  }
  if (shapeIndex > 0) {
    parts.push(
      `${String(shapeIndex)} shape-index operation(s) in this kind were not issued at all: a shape index needs a bounded time window this registry does not carry`,
    );
  }
  return `bounded — ${parts.join("; ")}`;
}

/**
 * The `api` cell for one kind, which is the whole point of this pass.
 *
 * Three outcomes, in the order they are decided. A kind with NOTHING this pass can call is first, because
 * reporting it through the same path as a kind that was called would put a record count of zero beside the
 * word `deferred` and read as an empty organisation.
 *
 * @param kind the atlas kind this verdict is about
 * @param outcomes its operation results, which decide both the state and the sentences under it
 * @param fanout how many of its entity operations take an identifier this pass cannot supply
 * @param shapeIndex how many of its operations need the windowed pass that is not built
 * @param previous the cell as it stood before, so a failing pass cannot erase an earlier live success
 * @param estateRecords how many of THIS ORGANISATION'S own records the pass published for this kind
 * @param at this run's ISO timestamp
 * @returns the cell to store under the `api` surface
 */
export function datadogApiCellFor({
  kind,
  outcomes,
  fanout,
  shapeIndex,
  previous,
  estateRecords,
  at,
}: {
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout: number;
  shapeIndex: number;
  previous: DatadogCoverageCell | null;
  estateRecords: number;
  at: string;
}): DatadogCoverageCell {
  const counts = datadogApiTally({ outcomes });
  const projections = outcomes.flatMap((one) => (one.projection === null ? [] : [one.projection]));
  // The FIRST failure, because a cell reports one and `stateFor` branches on its code — a kind whose reads
  // failed several different ways is reported by the first, with the count in the reason beside it.
  const failed = outcomes.find((one) => one.error !== null);
  const firstFailure = failed === undefined ? null : failed.error;
  const bounded = counts.firstPageOnly > 0 || counts.specNamesOnly > 0 || fanout > 0 || shapeIndex > 0;
  const outcome = readOutcomeFor({ bounded, counts, fanout, firstFailure, shapeIndex });
  const cell = storedDatadogCoverageCell({
    cell: datadogCoverageCell({
      at,
      channel: DATADOG_API_CHANNEL,
      disposition: "entity",
      kind,
      outcome,
      // Carried forward so a failing pass cannot erase an earlier live success — the stored cell is the
      // kit cell minus two fields, so it is widened back before it is handed to a builder that reads them.
      previous: previous === null ? null : { ...previous, artifacts: [], visibilityScope: DATADOG_VISIBILITY_SCOPE },
      projections,
      // `authoritative`: for what this organisation holds, its own API is the source of record. The
      // compiled catalogue is `discovery` for the same kind, and the difference is the atlas's whole point.
      role: "authoritative",
    }),
    channel: "api",
  });
  return withEstateNote({ cell, estateRecords, kind, outcomes });
}

/**
 * Say what the ESTATE count is, on the cell a reader meets before quoting any number.
 *
 * Composed onto the finished cell rather than threaded through `datadogCoverageCell`, which is shared by
 * all three channels: only the `api` channel can hold this organisation's own records, so a parameter on
 * the shared builder would be a field two of its three callers must always pass zero for.
 *
 * The sentence is the one the finding turns on. `atlas datadog read --kind monitor` answered "29 matching
 * STORED entities" while every one of them was an SDK operation, so the count that matters is not how many
 * entities a kind holds but how many of them are THIS ORGANISATION'S. A kind whose estate this atlas does
 * not fill says so in those words rather than reporting a silent zero.
 *
 * A SILENCE is not a zero, and this function refuses to write one as one. When the list operation did not
 * answer — a 403, a transport failure, a kind this pass could make no call in — the estate count is zero
 * for a reason that has nothing to do with what the organisation holds, and the cell's own failure reason
 * already carries it. Printing `ESTATE: 0` there would restate the atlas's original defect in the exact
 * words meant to close it, which a test caught the first time this shipped.
 *
 * @param cell the cell as the shared builder produced it
 * @param estateRecords how many of this organisation's own records this pass published for the kind
 * @param kind the kind, so the sentence can name the verb that would widen it
 * @param outcomes every operation's result, so a silent list can be told from an empty one
 * @returns the cell with the estate stated in its reason
 */
function withEstateNote({
  cell,
  estateRecords,
  kind,
  outcomes,
}: {
  cell: DatadogCoverageCell;
  estateRecords: number;
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
}): DatadogCoverageCell {
  const row = datadogEstateRowFor({ kind });
  if (row === null) {
    return cell;
  }
  const listed = outcomes.find((one) => one.row.name === row.surface && one.projection !== null);
  if (listed === undefined) {
    return {
      ...cell,
      reason:
        `${cell.reason}; ESTATE: NOT READ — \`${row.surface}\` did not answer this pass, so this kind holds` +
        ` none of this organisation's own ${row.noun} records for a reason above and NOT because there are` +
        " none",
    };
  }
  return {
    ...cell,
    reason:
      `${cell.reason}; ESTATE: ${String(estateRecords)} of this organisation's own ${row.noun} record(s) are` +
      ` stored as entities of their own, exploded out of \`${row.surface}\`'s own answer — every OTHER entity` +
      " in this kind is an SDK operation and describes Datadog rather than this organisation",
  };
}

/** Which of the three read outcomes this kind earned. Split out so `apiCellFor` stays inside its cap. */
function readOutcomeFor({
  bounded,
  counts,
  fanout,
  firstFailure,
  shapeIndex,
}: {
  bounded: boolean;
  counts: DatadogApiTally;
  fanout: number;
  firstFailure: DatadogAtlasError | null;
  shapeIndex: number;
}): DatadogReadOutcome {
  if (firstFailure !== null) {
    return { error: firstFailure, status: "incomplete" };
  }
  // Before `complete`, because the two are indistinguishable from a record count alone and only one of them
  // is a success. `coverage.ts`'s header carries the 18 kinds that published `synced` having asked nothing.
  if (counts.attempted === 0 && !bounded) {
    return {
      because:
        "this pass made NO call in this kind and has no remainder to defer: every operation the registry carries for it is `excluded` or `probe-only`, so nothing here is callable at all. A zero record count means nothing was asked, never that this organisation holds none",
      status: "nothing-callable",
    };
  }
  if (!bounded) {
    return { status: "complete" };
  }
  return {
    because: boundedBecause({ counts, fanout, shapeIndex }),
    status: "bounded",
    unblockedBy: unblockedByFor({ counts, fanout, shapeIndex }),
  };
}

/** What would widen a bounded kind, named as the specific piece of work rather than as "more coverage". */
function unblockedByFor({
  counts,
  fanout,
  shapeIndex,
}: {
  counts: { firstPageOnly: number; specNamesOnly: number };
  fanout: number;
  shapeIndex: number;
}): string {
  const wanted: string[] = [];
  if (counts.firstPageOnly > 0) {
    wanted.push(
      "a paging walk that reads each operation's own `pagingParameter` off `generated/pagingParameters.ts` and follows it to exhaustion",
    );
  }
  if (counts.specNamesOnly > 0) {
    wanted.push(
      "a fresh response census that measures those operations answering (`tools/datadogResponseCensus.ts`), then the response boundaries regenerated from it (`tools/generateDatadogResponseBoundaries.ts`)",
    );
  }
  if (fanout > 0) {
    wanted.push(
      "a fan-out pass that issues each identifier-taking operation once per entity this atlas already stores",
    );
  }
  if (shapeIndex > 0) {
    wanted.push("a windowed shape-index pass that folds an occurrence family into attribute paths and types");
  }
  return wanted.join("; then ");
}
