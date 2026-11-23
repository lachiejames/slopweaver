import type { v2 } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import { readTotalCount } from "../../../datadog/logsCount.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Build a response with one bucket carrying the given computes map. */
function responseWith({
  computes,
}: {
  computes: Record<string, v2.LogsAggregateBucketValue>;
}): v2.LogsAggregateResponse {
  return { data: { buckets: [{ by: {}, computes }] } };
}

describe("readTotalCount", () => {
  it("reads a numeric count, the shape a live response returns", () => {
    expect(unwrap(readTotalCount({ response: responseWith({ computes: { c0: 61_083 } }) }))).toBe(61_083);
  });

  it("reads a genuine zero as a zero", () => {
    expect(unwrap(readTotalCount({ response: responseWith({ computes: { c0: 0 } }) }))).toBe(0);
  });

  it("reads a count that arrived as a string, which the SDK type admits", () => {
    expect(unwrap(readTotalCount({ response: responseWith({ computes: { c0: "4200" } }) }))).toBe(4200);
  });

  it("reads Datadog's empty encoding — an empty bucket list — as a real zero", () => {
    // An unmatched query and an empty window BOTH return `buckets: []`, never a bucket holding `c0: 0`. This
    // zero is therefore Datadog's answer, not an unreadable response coerced into one.
    expect(unwrap(readTotalCount({ response: { data: { buckets: [] } } }))).toBe(0);
  });

  it("fails rather than returning zero when data.buckets is absent", () => {
    const error = unwrapErr(readTotalCount({ response: {} }));
    expect(error.code).toBe("LOG_BUCKETS_MISSING");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("no `data.buckets` field");
    expect(errors[0]).toContain("NOT an empty result");
  });

  it("fails rather than returning zero when the bucket has no computes", () => {
    const error = unwrapErr(readTotalCount({ response: { data: { buckets: [{ by: {} }] } } }));
    expect(error.code).toBe("LOG_COMPUTES_MISSING");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("logs use `computes` (plural) and spans use `compute` (singular)");
  });

  it("fails when the singular spans key was returned instead — the trap this guards", () => {
    const error = unwrapErr(readTotalCount({ response: { data: { buckets: [{ by: {} }] } } }));
    expect(error.code).toBe("LOG_COMPUTES_MISSING");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("looks exactly like an empty result");
  });

  it("fails and lists the keys present when c0 is missing", () => {
    const error = unwrapErr(readTotalCount({ response: responseWith({ computes: { c1: 5 } }) }));
    expect(error.code).toBe("LOG_COMPUTE_MISSING");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("no 'c0' compute");
    expect(errors[0]).toContain("c1");
  });

  it("refuses a SINGLE grouped bucket, which the bucket count alone cannot catch", () => {
    const response: v2.LogsAggregateResponse = {
      data: { buckets: [{ by: { service: "only-service" }, computes: { c0: 1 } }] },
    };
    const error = unwrapErr(readTotalCount({ response }));
    expect(error.code).toBe("LOG_BUCKET_GROUPED");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("grouped by service");
  });

  it("accepts a bucket with no by field at all as ungrouped", () => {
    expect(unwrap(readTotalCount({ response: { data: { buckets: [{ computes: { c0: 7 } }] } } }))).toBe(7);
  });

  it("refuses to read one of several buckets as the whole answer", () => {
    const response: v2.LogsAggregateResponse = {
      data: {
        buckets: [
          { by: { service: "a" }, computes: { c0: 1 } },
          { by: { service: "b" }, computes: { c0: 2 } },
        ],
      },
    };
    const error = unwrapErr(readTotalCount({ response }));
    expect(error.code).toBe("LOG_BUCKET_COUNT_INVALID");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("returned 2 buckets for an ungrouped total");
  });

  it("fails on a string that is not an integer instead of yielding NaN", () => {
    const error = unwrapErr(readTotalCount({ response: responseWith({ computes: { c0: "lots" } }) }));
    expect(error.code).toBe("LOG_COUNT_STRING_INVALID");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("as the string 'lots'");
  });

  it("fails on a timeseries array, which means the response did not match the request", () => {
    const error = unwrapErr(
      readTotalCount({ response: responseWith({ computes: { c0: [{ time: "0", value: 1 }] } }) }),
    );
    expect(error.code).toBe("LOG_COUNT_NOT_SCALAR");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("a timeseries array");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1])("fails on the unusable number %s", (c0) => {
    const error = unwrapErr(readTotalCount({ response: responseWith({ computes: { c0 } }) }));
    expect(["LOG_COUNT_NOT_SAFE_INTEGER", "LOG_COUNT_NEGATIVE"]).toContain(error.code);
    expect(datadogQueryErrorLines({ error })).toHaveLength(1);
  });

  it("fails on a digit string too long to survive as a number, rather than reporting Infinity as a match", () => {
    const error = unwrapErr(readTotalCount({ response: responseWith({ computes: { c0: "9".repeat(400) } }) }));
    expect(error.code).toBe("LOG_COUNT_NOT_SAFE_INTEGER");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("is not a safe integer");
  });

  it("fails on a digit string past the safe-integer bound, where precision is already lost", () => {
    const error = unwrapErr(readTotalCount({ response: responseWith({ computes: { c0: "9007199254740993" } }) }));
    expect(error.code).toBe("LOG_COUNT_NOT_SAFE_INTEGER");
    const errors = datadogQueryErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("is not a safe integer");
  });

  it("accepts the largest count that is still exact", () => {
    const max = String(Number.MAX_SAFE_INTEGER);
    expect(unwrap(readTotalCount({ response: responseWith({ computes: { c0: max } }) }))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
