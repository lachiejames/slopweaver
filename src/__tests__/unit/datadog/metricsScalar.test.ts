import type { v2 } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import { buildMetricsScalarRequest, readMetricsScalarBuckets } from "../../../datadog/metricsScalar.js";
import type { DatadogMetricsScalarError } from "../../../datadog/metricsScalarErrors.js";
import { type Result, unwrap, unwrapErr } from "../../../lib/result.js";

/** The one line a refused response prints, after asserting it was refused as `code` rather than merely refused. */
function scalarLines({
  result,
  code,
}: {
  result: Result<unknown, DatadogMetricsScalarError>;
  code: DatadogMetricsScalarError["code"];
}): readonly string[] {
  const error = unwrapErr(result);
  expect(error.code).toBe(code);
  return [error.message];
}

/** Build a scalar response from a set of group columns plus one number column. */
function responseWith({
  groups,
  numbers,
}: {
  groups: readonly { name: string; values: readonly string[][] }[];
  numbers: readonly (number | null)[];
}): v2.ScalarFormulaQueryResponse {
  return {
    data: {
      attributes: {
        columns: [
          ...groups.map((group) => ({ type: "group" as const, name: group.name, values: [...group.values] })),
          { type: "number" as const, name: "q1", values: [...numbers] },
        ],
      },
    },
  };
}

describe("buildMetricsScalarRequest", () => {
  it("builds the exact request shape", () => {
    const request = buildMetricsScalarRequest({
      query: "sum:example.metric{*} by {delivery_status}.as_count()",
      window: { fromMs: 1000, toMs: 2000 },
      limit: 500,
    });
    expect(request).toEqual({
      data: {
        type: "scalar_request",
        attributes: {
          from: 1000,
          to: 2000,
          queries: [
            {
              aggregator: "sum",
              dataSource: "metrics",
              name: "q1",
              query: "sum:example.metric{*} by {delivery_status}.as_count()",
            },
          ],
          formulas: [{ formula: "q1", limit: { count: 500, order: "desc" } }],
        },
      },
    });
  });
});

describe("readMetricsScalarBuckets", () => {
  it("reads a single-tag, multi-bucket response, the shape a live query returns", () => {
    const response = responseWith({
      groups: [{ name: "delivery_status", values: [["failed"], ["delivered"]] }],
      numbers: [12, 340],
    });
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 1000 }));
    expect(result.buckets).toEqual([
      { by: { delivery_status: "failed" }, count: 12 },
      { by: { delivery_status: "delivered" }, count: 340 },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reads multiple tag columns per bucket, matched by name rather than array position", () => {
    const response = responseWith({
      groups: [
        { name: "region", values: [["au"]] },
        { name: "delivery_status", values: [["failed"]] },
      ],
      numbers: [5],
    });
    const result = unwrap(
      readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status", "region"], limit: 1000 }),
    );
    expect(result.buckets).toEqual([{ by: { region: "au", delivery_status: "failed" }, count: 5 }]);
  });

  it("reads Datadog's N/A tag value as a real string, not an absence to be inferred", () => {
    const response = responseWith({
      groups: [{ name: "error_reason", values: [["N/A"]] }],
      numbers: [1],
    });
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["error_reason"], limit: 1000 }));
    expect(result.buckets[0]?.by["error_reason"]).toBe("N/A");
  });

  it("reads an empty result as a real empty result, not an error", () => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [] }], numbers: [] });
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 1000 }));
    expect(result.buckets).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("marks a bucket count exactly at the limit as truncated", () => {
    const response = responseWith({
      groups: [{ name: "delivery_status", values: [["failed"], ["delivered"]] }],
      numbers: [1, 2],
    });
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 2 }));
    expect(result.truncated).toBe(true);
  });

  it("does not mark a bucket count below the limit as truncated", () => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [["failed"]] }], numbers: [1] });
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 2 }));
    expect(result.truncated).toBe(false);
  });

  it("fails rather than returning zero when a server-side error accompanies the response", () => {
    const errors = scalarLines({
      code: "SCALAR_RESPONSE_ERROR",
      result: readMetricsScalarBuckets({ response: { errors: "query timed out" }, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("query timed out");
  });

  it("reports a malformed server-side errors field without serialising it, even when it is a pathologically deep array", () => {
    let deepArray: unknown = 0;
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepArray = [deepArray];
    }
    const response = { errors: deepArray } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "SCALAR_RESPONSE_ERROR",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("an array of length 1");
  });

  it("fails when data.attributes.columns is absent", () => {
    const errors = scalarLines({
      code: "SCALAR_COLUMNS_MISSING",
      result: readMetricsScalarBuckets({ response: {}, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("no `data.attributes.columns` field");
    expect(errors[0]).toContain("NOT an empty result");
  });

  it("fails rather than throwing when columns is not an array at all", () => {
    // Cast: exercising a response shape the SDK's own type does not admit but a live server response could.
    const response = { data: { attributes: { columns: {} } } } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "SCALAR_COLUMNS_NOT_ARRAY",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("is not an array");
  });

  it("fails rather than throwing when columns is explicitly null, not merely absent", () => {
    // Cast: exercising a response shape the SDK's own type does not admit but a live server response could.
    const response = { data: { attributes: { columns: null } } } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "SCALAR_COLUMNS_MISSING",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("no `data.attributes.columns` field");
  });

  it("fails rather than reporting a false empty result when the number column values field is explicitly null", () => {
    // A null count column means the count was unreadable, not that zero buckets exist — `?? 0` must never
    // fold that into a healthy empty result.
    const response = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [] },
            { type: "number", name: "q1", values: null },
          ],
        },
      },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "COLUMN_VALUES_NOT_ARRAY",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("not an array");
  });

  it("fails on a column of unrecognised type", () => {
    // Cast: deliberately a malformed shape the SDK's own type union cannot express except via `UnparsedObject`
    // (which requires constructing `_data`), and this test's whole point is exercising that malformed shape.
    const response = {
      data: { attributes: { columns: [{ type: "timeseries" }] } },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "COLUMN_TYPE_UNRECOGNISED",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("unrecognised type 'timeseries'");
  });

  it("fails rather than throwing when a column array entry is null", () => {
    const response = {
      data: { attributes: { columns: [null, { type: "number", name: "q1", values: [] }] } },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "COLUMN_ENTRY_NOT_OBJECT",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("not an object");
  });

  it("fails when no number column is present", () => {
    const response: v2.ScalarFormulaQueryResponse = {
      data: { attributes: { columns: [{ type: "group", name: "x", values: [] }] } },
    };
    const errors = scalarLines({
      code: "NUMBER_COLUMN_MISSING",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("no number column");
  });

  it("fails when more than one number column is present", () => {
    const response: v2.ScalarFormulaQueryResponse = {
      data: {
        attributes: {
          columns: [
            { type: "number", name: "q1", values: [1] },
            { type: "number", name: "q2", values: [2] },
          ],
        },
      },
    };
    const errors = scalarLines({
      code: "NUMBER_COLUMNS_MULTIPLE",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("more than one number column");
  });

  it("fails when an expected tag is missing from the response", () => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [["failed"]] }], numbers: [1] });
    const errors = scalarLines({
      code: "GROUP_COLUMNS_MISMATCH",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status", "region"], limit: 10 }),
    });
    expect(errors[0]).toContain("missing: region");
  });

  it("fails when the response carries a tag that was not requested", () => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [["failed"]] }], numbers: [1] });
    const errors = scalarLines({
      code: "GROUP_COLUMNS_MISMATCH",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("unexpected: delivery_status");
  });

  it("fails on duplicate group column names", () => {
    const response: v2.ScalarFormulaQueryResponse = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [["failed"]] },
            { type: "group", name: "delivery_status", values: [["delivered"]] },
            { type: "number", name: "q1", values: [1] },
          ],
        },
      },
    };
    const errors = scalarLines({
      code: "GROUP_COLUMN_NAMES_DUPLICATED",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("duplicate group column names");
  });

  it("fails when a group column's length disagrees with the number column's — the parallel-array contract", () => {
    const response: v2.ScalarFormulaQueryResponse = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [["failed"]] },
            { type: "number", name: "q1", values: [1, 2] },
          ],
        },
      },
    };
    const errors = scalarLines({
      code: "COLUMN_LENGTH_MISMATCH",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("parallel-array contract does not hold");
  });

  it("fails when a bucket carries more than one value in a group column cell", () => {
    const response: v2.ScalarFormulaQueryResponse = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [["failed", "extra"]] },
            { type: "number", name: "q1", values: [1] },
          ],
        },
      },
    };
    const errors = scalarLines({
      code: "GROUP_CELL_CARDINALITY_INVALID",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("carries 2 value(s)");
  });

  it("fails rather than throwing when a group column cell is null rather than a one-element array", () => {
    const response = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [null] },
            { type: "number", name: "q1", values: [1] },
          ],
        },
      },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "GROUP_CELL_CARDINALITY_INVALID",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("carries no value(s)");
  });

  it("fails rather than reporting a false empty result when a values field is an array-like object, not a real array", () => {
    // A plain object with numeric-string keys and a `length` property passes every `?.length` check
    // downstream without ever being iterable — this is the shape that check must catch directly.
    const response = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: { "0": ["failed"], length: 0 } },
            { type: "number", name: "q1", values: { "0": 7, length: 0 } },
          ],
        },
      },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "COLUMN_VALUES_NOT_ARRAY",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("not an array");
  });

  it("fails on a null count rather than treating it as zero", () => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [["failed"]] }], numbers: [null] });
    const errors = scalarLines({
      code: "BUCKET_COUNT_MISSING",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("no count for bucket 0");
  });

  it.each([
    [Number.NaN, "BUCKET_COUNT_NOT_SAFE_INTEGER"],
    [Number.POSITIVE_INFINITY, "BUCKET_COUNT_NOT_SAFE_INTEGER"],
    [1.5, "BUCKET_COUNT_NOT_SAFE_INTEGER"],
    [-1, "BUCKET_COUNT_NEGATIVE"],
  ] as const)("fails on the unusable count %s", (count, code) => {
    const response = responseWith({ groups: [{ name: "delivery_status", values: [["failed"]] }], numbers: [count] });
    expect(
      scalarLines({
        code,
        result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
      }),
    ).toHaveLength(1);
  });

  it("fails on two buckets carrying the identical tag combination", () => {
    const response = responseWith({
      groups: [{ name: "delivery_status", values: [["failed"], ["failed"]] }],
      numbers: [1, 2],
    });
    const errors = scalarLines({
      code: "BUCKET_TAGS_DUPLICATED",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("identical tag combination");
  });

  it("reports a malformed values field without serialising it, so a pathologically deep object cannot crash error construction itself", () => {
    let deepObject: unknown = 0;
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepObject = { x: deepObject };
    }
    const response = {
      data: { attributes: { columns: [{ type: "number", name: "q1", values: deepObject }] } },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "COLUMN_VALUES_NOT_ARRAY",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("not an array");
  });

  it("reports a malformed count without serialising it, even when the malformed cell is a pathologically deep array", () => {
    let deepArray: unknown = 0;
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepArray = [deepArray];
    }
    const response = {
      data: { attributes: { columns: [{ type: "number", name: "q1", values: [deepArray] }] } },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "BUCKET_COUNT_NOT_SAFE_INTEGER",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: [], limit: 10 }),
    });
    expect(errors[0]).toContain("not a safe integer");
  });

  it("reports a group-column tag mismatch without serialising it, even when a column name is a pathologically deep array", () => {
    let deepName: unknown = "delivery_status";
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepName = [deepName];
    }
    const response = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: deepName, values: [["failed"]] },
            { type: "number", name: "q1", values: [1] },
          ],
        },
      },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const errors = scalarLines({
      code: "GROUP_COLUMNS_MISMATCH",
      result: readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }),
    });
    expect(errors[0]).toContain("do not match the expected tags");
  });

  it("sanitises a pathologically deep cell value rather than letting it reach duplicate-key serialisation unchecked", () => {
    let deepCellValue: unknown = "failed";
    for (let depth = 0; depth < 20_000; depth += 1) {
      deepCellValue = [deepCellValue];
    }
    const response = {
      data: {
        attributes: {
          columns: [
            { type: "group", name: "delivery_status", values: [[deepCellValue]] },
            { type: "number", name: "q1", values: [1] },
          ],
        },
      },
    } as unknown as v2.ScalarFormulaQueryResponse;
    const result = unwrap(readMetricsScalarBuckets({ response, expectedGroupTags: ["delivery_status"], limit: 10 }));
    expect(result.buckets[0]?.by["delivery_status"]).toBe("an array of length 1");
  });
});
