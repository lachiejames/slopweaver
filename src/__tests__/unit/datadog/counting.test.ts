import { describe, expect, it } from "vitest";

import {
  auditBucketPartition,
  populationOf,
  readUngroupedTotal,
  refuseBucketsAsPopulation,
  sumBuckets,
} from "../../../datadog/counting.js";
import type { CensusBucket } from "../../../datadog/groupedAggregate.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A bucket, keyed by one facet. */
function bucket({ facet, value, count }: { facet: string; value: string | null; count: number }): CensusBucket {
  return { by: { [facet]: value }, count };
}

describe("sumBuckets", () => {
  it("sums the counts", () => {
    expect(
      sumBuckets({
        buckets: [
          bucket({ facet: "status", value: "info", count: 1855 }),
          bucket({ facet: "status", value: "warn", count: 10 }),
          bucket({ facet: "status", value: "error", count: 7 }),
        ],
      }),
    ).toBe(1872);
  });

  it("is zero over no buckets", () => {
    expect(sumBuckets({ buckets: [] })).toBe(0);
  });
});

describe("auditBucketPartition — the arithmetic that catches multi-counting", () => {
  it("grades a clean partition, using an example status breakdown", () => {
    const audit = auditBucketPartition({
      buckets: [
        bucket({ facet: "status", value: "info", count: 1855 }),
        bucket({ facet: "status", value: "warn", count: 10 }),
        bucket({ facet: "status", value: "error", count: 7 }),
      ],
      total: 1872,
      facet: "status",
    });
    expect(audit.verdict).toBe("partition");
    expect(audit.difference).toBe(0);
    expect(audit.bucketed).toBe(1872);
    expect(audit.reasons).toEqual([]);
    expect(audit.countingRule).toContain("one event counted once");
  });

  it("grades a shortfall as a residual, stating the gap without claiming its cause", () => {
    const audit = auditBucketPartition({
      buckets: [
        bucket({ facet: "host", value: "", count: 69_050 }),
        bucket({ facet: "host", value: "example.com", count: 253_271 }),
      ],
      total: 325_539,
      facet: "host",
    });
    expect(audit.verdict).toBe("residual");
    expect(audit.difference).toBe(3218);
    expect(audit.countingRule).toBe(
      "the 'host' buckets are short by 3218: they sum to 322321 against 325539 matched events, so 3218 appear in no bucket",
    );
    expect(audit.reasons[1]).toContain("different from an empty-string value");
    expect(audit.reasons[1]).toContain("one explanation, not a proven cause");
    expect(audit.reasons[2]).toContain("two endpoints, or at two moments");
  });

  it("grades an excess as inflation and refuses to call it a count", () => {
    const audit = auditBucketPartition({
      buckets: [
        bucket({ facet: "@long_task.scripts", value: "a", count: 900 }),
        bucket({ facet: "@long_task.scripts", value: "b", count: 400 }),
      ],
      total: 1000,
      facet: "@long_task.scripts",
    });
    expect(audit.verdict).toBe("inflated");
    expect(audit.difference).toBe(-300);
    expect(audit.countingRule).toBe(
      "NOT a count of events: the '@long_task.scripts' buckets sum to 1300 against only 1000 matched events, an excess of 300, so they do not establish a one-event-once partition",
    );
    expect(audit.countingRule).not.toContain("times over");
  });

  it("names every possible cause, cross-endpoint disagreement included, and proves none", () => {
    const audit = auditBucketPartition({
      buckets: [bucket({ facet: "@shape", value: "x", count: 20 })],
      total: 10,
      facet: "@shape",
    });
    expect(audit.reasons[2]).toBe(
      "possible causes, none proven by the arithmetic: an array-valued '@shape' (one event counted once per element), the same error logged under two field shapes, or the total and the buckets disagreeing across endpoints or indexing moments",
    );
    expect(audit.reasons.join(" ")).not.toContain("multi-counting");
  });

  it("treats an empty breakdown over an empty total as a clean partition", () => {
    const audit = auditBucketPartition({ buckets: [], total: 0, facet: "status" });
    expect(audit.verdict).toBe("partition");
    expect(audit.difference).toBe(0);
  });
});

describe("refuseBucketsAsPopulation — there is deliberately no way to opt out", () => {
  it("names the truncation signal when the count equals the limit", () => {
    const error = unwrapErr(refuseBucketsAsPopulation({ facet: "@userId", bucketCount: 10, requestedLimit: 10 }));
    expect(error.code).toBe("BUCKETS_NOT_POPULATION");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("refusing to report 10 '@userId' buckets");
    expect(errors[1]).toContain("equals the requested limit of 10");
  });

  it("still refuses below the limit, because completeness is not established by it", () => {
    const error = unwrapErr(refuseBucketsAsPopulation({ facet: "@userId", bucketCount: 3, requestedLimit: 50 }));
    expect(error.code).toBe("BUCKETS_NOT_POPULATION");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[1]).toContain("consistent with completeness but does not establish it");
  });

  it("always points at the call that would answer honestly", () => {
    const error = unwrapErr(refuseBucketsAsPopulation({ facet: "service", bucketCount: 2, requestedLimit: 50 }));
    expect(error.code).toBe("BUCKETS_NOT_POPULATION");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[2]).toContain("ungrouped cardinality(service) compute");
  });
});

describe("populationOf — a population comes from an ungrouped cardinality or not at all", () => {
  it("reads the distinct count off a single ungrouped bucket", () => {
    expect(unwrap(populationOf({ facet: "@userId", buckets: [{ by: {}, count: 13 }] }))).toBe(13);
  });

  it("reads no buckets as a genuine zero, matching how an empty aggregate is encoded", () => {
    expect(unwrap(populationOf({ facet: "@userId", buckets: [] }))).toBe(0);
  });

  it("refuses several buckets, because that compute was grouped", () => {
    const error = unwrapErr(
      populationOf({
        facet: "@role",
        buckets: [
          bucket({ facet: "service", value: "example-worker", count: 2 }),
          bucket({ facet: "service", value: "example-api", count: 4 }),
        ],
      }),
    );
    expect(error.code).toBe("CARDINALITY_BUCKET_COUNT_INVALID");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("returned 2 buckets, so it was grouped rather than ungrouped");
    expect(errors[1]).toContain("a grouped cardinality lies about presence");
  });

  it("refuses a single bucket that is nonetheless grouped", () => {
    const error = unwrapErr(
      populationOf({ facet: "@role", buckets: [bucket({ facet: "service", value: "example-worker", count: 2 })] }),
    );
    expect(error.code).toBe("CARDINALITY_BUCKET_GROUPED");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("grouped by service");
  });
});

describe("readUngroupedTotal — one rule, shared by the query path and the proof oracle", () => {
  it("reads a single ungrouped bucket", () => {
    expect(unwrap(readUngroupedTotal({ route: "/agg", buckets: [{ by: {}, count: 1872 }] }))).toBe(1872);
  });

  it("reads no buckets as a genuine zero, which is what an absence claim rests on", () => {
    expect(unwrap(readUngroupedTotal({ route: "/agg", buckets: [] }))).toBe(0);
  });

  it("refuses several buckets rather than reading a fragment as the whole", () => {
    const error = unwrapErr(
      readUngroupedTotal({
        route: "/agg",
        buckets: [
          bucket({ facet: "status", value: "info", count: 5 }),
          bucket({ facet: "status", value: "error", count: 2 }),
        ],
      }),
    );
    expect(error.code).toBe("UNGROUPED_BUCKET_COUNT_INVALID");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("returned 2 buckets for an ungrouped total");
    expect(errors[1]).toContain("a fragment of the answer as the whole of it");
  });

  it("refuses one bucket that is nonetheless per-group, which is a different claim from there being one", () => {
    const error = unwrapErr(
      readUngroupedTotal({ route: "/agg", buckets: [bucket({ facet: "service", value: "example-api", count: 9 })] }),
    );
    expect(error.code).toBe("UNGROUPED_BUCKET_GROUPED");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("grouped by service");
  });

  it("names the route, so the reason says which call misbehaved", () => {
    const error = unwrapErr(
      readUngroupedTotal({
        route: "/api/v2/logs/analytics/aggregate",
        buckets: [
          { by: {}, count: 1 },
          { by: {}, count: 2 },
        ],
      }),
    );
    expect(error.code).toBe("UNGROUPED_BUCKET_COUNT_INVALID");
    expect(datadogQueryErrorLines({ error })[0]).toContain("/api/v2/logs/analytics/aggregate");
  });
});
