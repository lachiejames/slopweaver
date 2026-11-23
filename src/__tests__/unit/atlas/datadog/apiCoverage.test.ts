/**
 * `apiCoverage.ts` — one kind's operation outcomes judged into its `api` coverage cell.
 *
 * Every outcome is built on a real registry row, so the estate lookup and the cell's scope read the same
 * names the live pass would.
 */
import { describe, expect, it } from "vitest";

import type { DatadogApiObservation } from "../../../../atlas/datadog/apiCall.js";
import { DATADOG_API_CHANNEL, datadogApiCellFor, datadogApiTally } from "../../../../atlas/datadog/apiCoverage.js";
import type { DatadogCoverageCell } from "../../../../atlas/datadog/documents.js";
import { type DatadogAtlasError, DatadogAtlasErrors } from "../../../../atlas/datadog/errors.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import type { DatadogKind } from "../../../../atlas/datadog/model.js";
import type { DatadogApiOperationOutcome } from "../../../../atlas/datadog/syncApiTypes.js";

const AT = "2026-10-13T00:00:00.000Z";
const EARLIER = "2026-10-01T00:00:00.000Z";

/** A kind with no estate row, so its reason carries no ESTATE sentence. */
const PLAIN_KIND: DatadogKind = "api_key";
/** The monitor list operation, which is the monitor kind's estate surface. */
const MONITOR_LIST = "v1-monitors-list-monitors";

/** The first real registry row of a kind, or the named one. */
function rowOf({ kind, name }: { kind: DatadogKind; name?: string | undefined }): DatadogApiOperationOutcome["row"] {
  return DATADOG_SURFACES.find((row) => row.kind === kind && (name === undefined || row.name === name))!;
}

/** An answered outcome, whole or first-page-only, admitted by a measured boundary or a names-only one. */
function answered({
  kind,
  name,
  bound = "whole",
  boundarySource = "measured",
}: {
  kind: DatadogKind;
  name?: string;
  bound?: DatadogApiObservation["bound"];
  boundarySource?: DatadogApiObservation["boundarySource"];
}): DatadogApiOperationOutcome {
  const observation: DatadogApiObservation = {
    bodies: [[]],
    bound,
    boundarySource,
    pagingParameter: null,
    status: 200,
  };
  return { error: null, observation, projection: { dropped: [], value: [] }, row: rowOf({ kind, name }) };
}

/** A failed outcome carrying the given error. */
function failed({
  kind,
  name,
  error,
}: {
  kind: DatadogKind;
  name?: string;
  error: DatadogAtlasError;
}): DatadogApiOperationOutcome {
  return { error, observation: null, projection: null, row: rowOf({ kind, name }) };
}

/** The cell for one kind with every count defaulted to zero and no previous cell. */
function cellFor({
  kind,
  outcomes,
  fanout = 0,
  shapeIndex = 0,
  previous = null,
  estateRecords = 0,
}: {
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout?: number;
  shapeIndex?: number;
  previous?: DatadogCoverageCell | null;
  estateRecords?: number;
}): DatadogCoverageCell {
  return datadogApiCellFor({ at: AT, estateRecords, fanout, kind, outcomes, previous, shapeIndex });
}

describe("DATADOG_API_CHANNEL", () => {
  it("is the literal api", () => {
    expect(DATADOG_API_CHANNEL).toBe("api");
  });
});

describe("datadogApiTally", () => {
  it("counts attempted, answered, failed, first-page-only and names-only across a mixed list", () => {
    const outcomes = [
      answered({ kind: PLAIN_KIND }),
      answered({ bound: "first-page", kind: PLAIN_KIND }),
      failed({ error: DatadogAtlasErrors.forbidden({ surface: "s" }), kind: PLAIN_KIND }),
      answered({ bound: "first-page", boundarySource: "spec-names-only", kind: PLAIN_KIND }),
    ];

    expect(datadogApiTally({ outcomes })).toEqual({
      answered: 3,
      attempted: 4,
      failed: 1,
      firstPageOnly: 2,
      specNamesOnly: 1,
    });
  });

  it("counts zero of everything for no outcomes", () => {
    expect(datadogApiTally({ outcomes: [] })).toEqual({
      answered: 0,
      attempted: 0,
      failed: 0,
      firstPageOnly: 0,
      specNamesOnly: 0,
    });
  });
});

describe("datadogApiCellFor", () => {
  it("grades a kind with no call and nothing deferred nothing-callable, as excluded and failed rather than synced", () => {
    expect(cellFor({ kind: PLAIN_KIND, outcomes: [] })).toEqual({
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason:
        "0 record(s) from api; this pass made NO call in this kind and has no remainder to defer: every operation the registry carries for it is `excluded` or `probe-only`, so nothing here is callable at all. A zero record count means nothing was asked, never that this organisation holds none",
      role: "authoritative",
      scope: PLAIN_KIND,
      state: "excluded",
      surface: "api",
      unblockedBy: null,
    });
  });

  it("grades one answered, unbounded operation synced, its reason carrying no estate sentence", () => {
    expect(cellFor({ estateRecords: 5, kind: PLAIN_KIND, outcomes: [answered({ kind: PLAIN_KIND })] })).toEqual({
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "1 record(s) from api",
      role: "authoritative",
      scope: PLAIN_KIND,
      state: "synced",
      surface: "api",
      unblockedBy: null,
    });
  });

  it("grades a first-page, fan-out and shape-index bound together deferred, naming each in order", () => {
    const cell = cellFor({
      fanout: 2,
      kind: PLAIN_KIND,
      outcomes: [answered({ bound: "first-page", kind: PLAIN_KIND })],
      shapeIndex: 3,
    });

    expect(cell).toEqual({
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason:
        "1 record(s) from api; bounded — 1 of them page and only their FIRST page was kept — the walk that follows a Datadog cursor is not built, and this pass will not guess where one lives in a response body; 2 further entity operation(s) in this kind take an identifier in their path, and the fan-out that would supply one from an already-stored entity does not exist; 3 shape-index operation(s) in this kind were not issued at all: a shape index needs a bounded time window this registry does not carry",
      role: "authoritative",
      scope: PLAIN_KIND,
      state: "deferred",
      surface: "api",
      unblockedBy:
        "a paging walk that reads each operation's own `pagingParameter` off `generated/pagingParameters.ts` and follows it to exhaustion; then a fan-out pass that issues each identifier-taking operation once per entity this atlas already stores; then a windowed shape-index pass that folds an occurrence family into attribute paths and types",
    });
  });

  it("never grades an answer admitted on the specification's names alone synced, but deferred and owed a census", () => {
    const cell = cellFor({
      kind: PLAIN_KIND,
      outcomes: [answered({ boundarySource: "spec-names-only", kind: PLAIN_KIND })],
    });

    expect(cell).toEqual({
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason:
        "1 record(s) from api; bounded — 1 answer(s) were admitted by a boundary holding only the specification's field names and kinds, every value under them unread, because no census had measured that operation answering",
      role: "authoritative",
      scope: PLAIN_KIND,
      state: "deferred",
      surface: "api",
      unblockedBy:
        "a fresh response census that measures those operations answering (`tools/datadogResponseCensus.ts`), then the response boundaries regenerated from it (`tools/generateDatadogResponseBoundaries.ts`)",
    });
  });

  it("names a first-page bound before a names-only one", () => {
    const cell = cellFor({
      kind: PLAIN_KIND,
      outcomes: [answered({ bound: "first-page", boundarySource: "spec-names-only", kind: PLAIN_KIND })],
    });

    expect(cell.reason).toBe(
      "1 record(s) from api; bounded — 1 of them page and only their FIRST page was kept — the walk that follows a Datadog cursor is not built, and this pass will not guess where one lives in a response body; 1 answer(s) were admitted by a boundary holding only the specification's field names and kinds, every value under them unread, because no census had measured that operation answering",
    );
    expect(cell.unblockedBy).toBe(
      "a paging walk that reads each operation's own `pagingParameter` off `generated/pagingParameters.ts` and follows it to exhaustion; then a fresh response census that measures those operations answering (`tools/datadogResponseCensus.ts`), then the response boundaries regenerated from it (`tools/generateDatadogResponseBoundaries.ts`)",
    );
  });

  it("reports the FIRST failure over a later one and keeps the previous cell's last success", () => {
    const forbidden = DatadogAtlasErrors.forbidden({ surface: "first-surface" });
    const previous: DatadogCoverageCell = {
      ...cellFor({ kind: PLAIN_KIND, outcomes: [answered({ kind: PLAIN_KIND })] }),
      lastSuccessAt: EARLIER,
    };
    const cell = cellFor({
      kind: PLAIN_KIND,
      outcomes: [
        answered({ kind: PLAIN_KIND }),
        failed({ error: forbidden, kind: PLAIN_KIND }),
        failed({ error: DatadogAtlasErrors.notImplemented({ surface: "second-surface" }), kind: PLAIN_KIND }),
      ],
      previous,
    });

    expect(cell).toEqual({
      channel: "api",
      lastSuccessAt: EARLIER,
      latestAttemptFailed: true,
      reason: `1 record(s) from api; ${forbidden.message}`,
      role: "authoritative",
      scope: PLAIN_KIND,
      state: "unavailable",
      surface: "api",
      unblockedBy:
        "this organisation cannot read this family. Grant the application key's owner the relevant Datadog permission, or accept it as a permanent boundary of what this atlas can claim",
    });
  });

  it("carries a FORBIDDEN failure's literal 403 message into the reason", () => {
    const forbidden = DatadogAtlasErrors.forbidden({ surface: "v1-x" });
    const cell = cellFor({ kind: PLAIN_KIND, outcomes: [failed({ error: forbidden, kind: PLAIN_KIND })] });

    expect(forbidden.code).toBe("FORBIDDEN");
    expect(cell.reason).toBe(
      "0 record(s) from api; v1-x answered 403: the credentials are valid and this organisation may not read it. One family failing this way while others succeed is a permission boundary, not a broken key",
    );
  });

  it("states ESTATE: 0 for an estate kind whose list answered", () => {
    const cell = cellFor({ kind: "monitor", outcomes: [answered({ kind: "monitor", name: MONITOR_LIST })] });

    expect(cell.reason).toBe(
      "1 record(s) from api; ESTATE: 0 of this organisation's own monitor record(s) are stored as entities of their own, exploded out of `v1-monitors-list-monitors`'s own answer — every OTHER entity in this kind is an SDK operation and describes Datadog rather than this organisation",
    );
  });

  it("states ESTATE: NOT READ, never a zero, for the same kind whose list did not answer", () => {
    const forbidden = DatadogAtlasErrors.forbidden({ surface: MONITOR_LIST });
    const cell = cellFor({
      kind: "monitor",
      outcomes: [failed({ error: forbidden, kind: "monitor", name: MONITOR_LIST })],
    });

    expect(cell.reason).toBe(
      `0 record(s) from api; ${forbidden.message}; ESTATE: NOT READ — \`v1-monitors-list-monitors\` did not answer this pass, so this kind holds none of this organisation's own monitor records for a reason above and NOT because there are none`,
    );
  });
});
