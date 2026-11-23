/*
 * What one kind's live `api` pass did NOT reach, driven directly rather than through the whole pass.
 *
 * Until the split these functions were private and reachable only through `runDatadogApiPass`, so the
 * distinction this file exists to protect — a kind that was called and came back with remainders reads
 * differently from a kind no call was ever made in — was asserted nowhere on its own. Every remainder here
 * is a real registry row, because a hand-built one would let the test and the registry disagree.
 */

import { describe, expect, it } from "vitest";

import {
  datadogApiFanoutDeferredByKind,
  datadogApiRowsFor,
  datadogApiShapeIndexDeferredByKind,
} from "../../../../atlas/datadog/apiAcquisition.js";
import type { DatadogApiObservation } from "../../../../atlas/datadog/apiCall.js";
import type { DatadogKind } from "../../../../atlas/datadog/model.js";
import { emptyDatadogKindFile } from "../../../../atlas/datadog/sync.js";
import { kindGapsFor } from "../../../../atlas/datadog/syncApiGaps.js";
import type { DatadogApiOperationOutcome } from "../../../../atlas/datadog/syncApiTypes.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-14T00:00:00.000Z";
/** A kind carrying BOTH admitted operations and identifier-taking ones, so "reached" can be either value. */
const MIXED_KIND: DatadogKind = "actions";
/** A kind carrying shape-index operations, which are deferred whole rather than excluded. */
const SHAPE_INDEX_KIND: DatadogKind = "audit";
/** A kind with no remainder of any sort, so an empty gap list is a real answer rather than a default. */
const CLEAN_KIND: DatadogKind = "api_key";

const fanoutOf = ({ kind }: { kind: DatadogKind }) =>
  datadogApiRowsFor({ byKind: datadogApiFanoutDeferredByKind(), kind });
const shapeIndexOf = ({ kind }: { kind: DatadogKind }) =>
  datadogApiRowsFor({ byKind: datadogApiShapeIndexDeferredByKind(), kind });

/** One outcome that answered, built from a real row of the kind under test. */
function answeredIn({
  kind,
  boundarySource = "measured",
}: {
  kind: DatadogKind;
  boundarySource?: DatadogApiObservation["boundarySource"];
}): DatadogApiOperationOutcome {
  const row = fanoutOf({ kind })[0]!;
  const observation: DatadogApiObservation = {
    bodies: [{ ok: true }],
    bound: "whole",
    boundarySource,
    pagingParameter: null,
    status: 200,
  };
  return { error: null, observation, projection: { dropped: [], value: [{ ok: true }] }, row };
}

/** The gaps one kind opens, with the remainders named explicitly by the case. */
function gapsFor({
  kind,
  outcomes,
  fanout = [],
  shapeIndex = [],
}: {
  kind: DatadogKind;
  outcomes: readonly DatadogApiOperationOutcome[];
  fanout?: ReturnType<typeof fanoutOf>;
  shapeIndex?: ReturnType<typeof shapeIndexOf>;
}) {
  return unwrap(
    kindGapsFor({ at: AT, fanout, kind, outcomes, shapeIndex, stored: emptyDatadogKindFile({ at: AT, kind }) }),
  );
}

describe("the registry remainders these cases stand on", () => {
  it("finds real rows for each remainder, so no case below is vacuous", () => {
    expect(fanoutOf({ kind: MIXED_KIND }).length).toBeGreaterThan(0);
    expect(shapeIndexOf({ kind: SHAPE_INDEX_KIND }).length).toBeGreaterThan(0);
    expect(fanoutOf({ kind: CLEAN_KIND })).toEqual([]);
    expect(shapeIndexOf({ kind: CLEAN_KIND })).toEqual([]);
  });
});

describe("kindGapsFor — a kind with no remainder", () => {
  it("opens no gap at all", () => {
    expect(gapsFor({ kind: CLEAN_KIND, outcomes: [] })).toEqual([]);
  });
});

describe("kindGapsFor — the fan-out that is not built", () => {
  it("opens one api-fanout-unbuilt gap naming an identifier-taking path", () => {
    const fanout = fanoutOf({ kind: MIXED_KIND });
    const gaps = gapsFor({ fanout, kind: MIXED_KIND, outcomes: [] });
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("api-fanout-unbuilt");
    expect(gaps[0]!.reason).toContain(fanout[0]!.path);
  });

  it("says a kind it made NO call in must not be read as an organisation holding none of it", () => {
    const gaps = gapsFor({ fanout: fanoutOf({ kind: MIXED_KIND }), kind: MIXED_KIND, outcomes: [] });
    expect(gaps[0]!.reason).toContain("this pass made no call here at all");
  });

  it("drops that sentence once a call in the kind answered, because the silence is no longer total", () => {
    const gaps = gapsFor({
      fanout: fanoutOf({ kind: MIXED_KIND }),
      kind: MIXED_KIND,
      outcomes: [answeredIn({ kind: MIXED_KIND })],
    });
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("api-fanout-unbuilt");
    expect(gaps[0]!.reason).not.toContain("this pass made no call here at all");
  });
});

describe("kindGapsFor — an answer admitted on the specification's names alone", () => {
  it("opens api-response-boundary-unmeasured only for a names-only admission, naming the census that closes it", () => {
    const gaps = gapsFor({
      kind: MIXED_KIND,
      outcomes: [answeredIn({ boundarySource: "spec-names-only", kind: MIXED_KIND })],
    });
    expect(gaps.map((gap) => gap.condition)).toEqual(["api-response-boundary-unmeasured"]);
    expect(gaps[0]!.reason).toBe(
      "1 answer(s) in `actions` were admitted by a boundary holding only the specification's field names and kinds, because no census had measured those operations answering — a renamed key is still refused, but every value under those names went unread. What closes this is a fresh census (`tools/datadogResponseCensus.ts`) and the boundaries regenerated from it, never a re-run of this pass",
    );
  });

  it("opens no such gap for an answer a measured boundary admitted", () => {
    expect(gapsFor({ kind: MIXED_KIND, outcomes: [answeredIn({ kind: MIXED_KIND })] })).toEqual([]);
  });
});

describe("kindGapsFor — the shape index that is not built", () => {
  it("opens an api-shape-index-unbuilt gap and says the operations are deferred rather than excluded", () => {
    const shapeIndex = shapeIndexOf({ kind: SHAPE_INDEX_KIND });
    const gaps = gapsFor({ kind: SHAPE_INDEX_KIND, outcomes: [], shapeIndex });
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("api-shape-index-unbuilt");
    expect(gaps[0]!.reason).toContain("They are NOT excluded");
  });
});
