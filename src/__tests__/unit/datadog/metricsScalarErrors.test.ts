import { describe, expect, it } from "vitest";

import { DatadogMetricsScalarErrors } from "../../../datadog/metricsScalarErrors.js";

describe("DatadogMetricsScalarErrors", () => {
  it("names the bucket whose count is missing", () => {
    expect(DatadogMetricsScalarErrors.bucketCountMissing({ bucketIndex: 3 })).toEqual({
      bucketIndex: 3,
      code: "BUCKET_COUNT_MISSING",
      message: "Datadog returned no count for bucket 3 — a count aggregation should never produce a null value",
    });
  });

  it("names a negative count and its bucket", () => {
    const error = DatadogMetricsScalarErrors.bucketCountNegative({ bucketIndex: 0, value: -1 });
    expect(error.code).toBe("BUCKET_COUNT_NEGATIVE");
    expect(error.message).toBe("Datadog returned -1 as bucket 0's count, and a count cannot be negative");
  });

  it("lists only the tag differences present in a group-column mismatch", () => {
    const both = DatadogMetricsScalarErrors.groupColumnsMismatch({
      actual: "service",
      expected: ["region"],
      missing: ["region"],
      unexpected: ["service"],
    });
    expect(both.code).toBe("GROUP_COLUMNS_MISMATCH");
    expect(both.message).toBe(
      "Datadog's group columns (service) do not match the expected tags (region); missing: region; unexpected: service",
    );
    const neither = DatadogMetricsScalarErrors.groupColumnsMismatch({
      actual: "(none)",
      expected: [],
      missing: [],
      unexpected: [],
    });
    expect(neither.message).toBe("Datadog's group columns ((none)) do not match the expected tags ()");
  });

  it("says a missing columns field is malformed, not empty", () => {
    const error = DatadogMetricsScalarErrors.scalarColumnsMissing();
    expect(error.code).toBe("SCALAR_COLUMNS_MISSING");
    expect(error.message).toBe(
      "Datadog returned a scalar-query response with no `data.attributes.columns` field. This is a malformed response, NOT an empty result",
    );
  });

  it("distinguishes an unreachable endpoint from a rejected query", () => {
    const unreachable = DatadogMetricsScalarErrors.metricsQueryUnreachable({
      apiHost: "api.us3.datadoghq.com",
      detail: "ETIMEDOUT",
    });
    expect(unreachable.code).toBe("METRICS_QUERY_UNREACHABLE");
    expect(unreachable.message).toBe(
      "the metrics scalar query never reached Datadog at api.us3.datadoghq.com: ETIMEDOUT",
    );
    const rejected = DatadogMetricsScalarErrors.metricsQueryRejected({ detail: "bad query", status: 400 });
    expect(rejected.code).toBe("METRICS_QUERY_REJECTED");
    expect(rejected.message).toBe("Datadog rejected the metrics scalar query with HTTP 400: bad query");
  });
});
