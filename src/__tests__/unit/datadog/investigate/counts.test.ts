import { describe, expect, it } from "vitest";

import { INDEXED_SPANS_CAVEAT, SAMPLING_CAVEAT } from "../../../../datadog/domain.js";
import { investigationCountFacts, SAMPLED_CORROBORATION_HINT } from "../../../../datadog/investigate/counts.js";

/** The inputs of one investigation whose aggregate came back, so a case names only what it changes. */
function facts(
  over: Partial<Parameters<typeof investigationCountFacts>[0]> = {},
): ReturnType<typeof investigationCountFacts> {
  return investigationCountFacts({
    aggregateRead: true,
    groupedBy: ["service"],
    groups: [
      { by: { service: "jobs-api" }, count: 60 },
      { by: { service: "core-api" }, count: 40 },
    ],
    groupsFromPage: false,
    product: "logs",
    total: 100,
    trafficType: null,
    truncated: false,
    ...over,
  });
}

const SAMPLED_APM = {
  caveats: [INDEXED_SPANS_CAVEAT],
  kind: "sampled-count",
  statedAs: "count over sampled traffic — a lower bound, not a total",
} as const;

describe("investigationCountFacts — the sampling label on the total", () => {
  it("labels an apm total sampled from its DOMAIN, never claiming the track declared traffic_type", () => {
    expect(facts({ product: "apm", trafficType: "sampled" }).countLabel).toEqual(SAMPLED_APM);
  });

  it("keeps the apm label sampled when the spans aggregate failed and nothing was declared", () => {
    expect(facts({ aggregateRead: false, product: "apm" }).countLabel).toEqual(SAMPLED_APM);
  });

  it("labels a logs total as a plain count", () => {
    expect(facts({}).countLabel).toEqual({ caveats: [], kind: "count", statedAs: "events" });
  });

  it("labels a rum total from the aggregate's declaration when it said sampled", () => {
    expect(facts({ product: "rum", trafficType: "sampled" }).countLabel).toEqual({
      caveats: [SAMPLING_CAVEAT],
      kind: "sampled-count",
      statedAs: "count over sampled traffic — a lower bound, not a total",
    });
  });

  it("reads no declaration off an aggregate that failed", () => {
    expect(facts({ aggregateRead: false, product: "ci", trafficType: "sampled" }).countLabel.kind).toBe("count");
  });

  it("makes no traffic_type claim for dbm, which has no aggregate", () => {
    expect(facts({ aggregateRead: false, groupsFromPage: true, product: "dbm" }).countLabel.kind).toBe("count");
  });
});

describe("investigationCountFacts — the corroboration hint travels in the result, so --json carries it", () => {
  it("carries the logs hint on a sampled apm total", () => {
    expect(facts({ product: "apm" }).corroborate).toBe(SAMPLED_CORROBORATION_HINT);
    expect(SAMPLED_CORROBORATION_HINT).toContain("`datadog logs` (unsampled)");
  });

  it("carries no hint on a logs total", () => {
    expect(facts({}).corroborate).toBeNull();
  });
});

describe("investigationCountFacts — the partition audit, and every gate that withholds it", () => {
  it("audits a single-facet grouping, naming the facet", () => {
    const partition = facts({}).partition!;
    expect(partition.verdict).toBe("partition");
    expect(partition.countingRule).toBe(
      "one event counted once: the 2 'service' buckets sum exactly to the 100 matched events",
    );
  });

  it("withholds the audit for 2 services × 20 statuses, which reads untruncated against a ceiling of 400", () => {
    const groups = ["jobs-api", "core-api"].flatMap((service) =>
      Array.from({ length: 20 }, (_, index) => ({ by: { service, status: `s${String(index)}` }, count: 5 })),
    );
    expect(groups.length).toBe(40);
    expect(facts({ groupedBy: ["service", "status"], groups, total: 1000, truncated: false }).partition).toBeNull();
  });

  it("grades the measured apm run as inflated", () => {
    const partition = facts({
      groups: [
        { by: { service: "jobs-api" }, count: 308_874 },
        { by: { service: "core-api" }, count: 195_268 },
      ],
      product: "apm",
      total: 206_474,
    }).partition!;
    expect(partition.verdict).toBe("inflated");
    expect(partition.bucketed).toBe(504_142);
    expect(partition.difference).toBe(-297_668);
  });

  it("withholds the audit for a truncated grouping, whose shortfall is the limit and not an absent facet", () => {
    expect(facts({ total: 1000, truncated: true }).partition).toBeNull();
  });

  it("withholds the audit for groups folded from a page", () => {
    expect(facts({ groupsFromPage: true, product: "dbm" }).partition).toBeNull();
  });

  it("withholds the audit after the aggregate failed", () => {
    expect(facts({ aggregateRead: false, groups: [] }).partition).toBeNull();
  });

  it("withholds the audit when the track could not say the total", () => {
    expect(facts({ total: null }).partition).toBeNull();
  });
});
