import { describe, expect, it } from "vitest";

import { bucketsFrom, spanBucketsFrom, trafficTypeFromMeta } from "../../../../datadog/census/aggregate.js";
import { unrunLines } from "../../../../datadog/census/build.js";
import { foldTwoLevel } from "../../../../datadog/census/ci.js";
import { foldMetricTags, splitTag } from "../../../../datadog/census/metrics.js";
import { mapBounded } from "../../../../datadog/census/pool.js";
import { CENSUS_PRODUCTS, censusProductNamed, censusProductSpec } from "../../../../datadog/census/product.js";
import { type CensusRow, censusKey, sortCensusRows } from "../../../../datadog/census/row.js";
import { serviceClause } from "../../../../datadog/census/scope.js";
import { trackListBody } from "../../../../datadog/census/unified.js";

/** One row, fully populated, so a fold or a sort that loses a field fails rather than passing quietly. */
function row({ count, key }: { count: number | null; key: string }): CensusRow {
  return {
    count,
    countFrom: count === null ? "none" : "aggregate",
    envs: ["production"],
    exemplars: 1,
    facets: [],
    firstSeenIso: "2026-09-15T00:00:00.000Z",
    identity: key,
    key,
    label: key,
    lastSeenIso: "2026-09-15T01:00:00.000Z",
    members: [],
    membersTruncated: false,
    paths: [],
    product: "logs",
    query: `service:"x" ${key}`,
    service: "x",
    statuses: ["info"],
    template: null,
  };
}

describe("censusProductSpec / censusProductNamed", () => {
  it("declares a spec for every product, so a reader of one list never falls off the other", () => {
    expect(CENSUS_PRODUCTS.length).toBeGreaterThan(0);
    expect(CENSUS_PRODUCTS.map((product) => censusProductSpec({ product }).product)).toEqual([...CENSUS_PRODUCTS]);
  });

  it("gives metrics no event track, because a metric is a name rather than an occurrence", () => {
    expect(censusProductSpec({ product: "metrics" }).track).toBeNull();
  });

  it("refuses a product name nothing goes by", () => {
    expect(censusProductNamed({ raw: "traces" })).toBeNull();
    expect(censusProductNamed({ raw: "spans" })).toBe("spans");
  });
});

describe("serviceClause — the absent bucket is selected by negating existence", () => {
  it("quotes a service name", () => {
    expect(serviceClause({ service: "acme-nightly-job-sync-partners" })).toBe(
      'service:"acme-nightly-job-sync-partners"',
    );
  });

  it("selects the events carrying no service at all, which no positive clause can reach", () => {
    expect(serviceClause({ service: "(none)" })).toBe("-service:*");
  });
});

describe("censusKey / sortCensusRows", () => {
  it("keys a row by product, service and identity, so two services sharing a pattern stay two rows", () => {
    expect(censusKey({ identity: "96dedf596944", product: "logs", service: "jobs-api" })).toBe(
      "logs|jobs-api|96dedf596944",
    );
  });

  it("orders by count, putting an uncountable row last rather than treating it as zero", () => {
    const sorted = sortCensusRows({
      rows: [row({ count: 5, key: "small" }), row({ count: null, key: "metric" }), row({ count: 900, key: "big" })],
    });
    expect(sorted.map((one) => one.key)).toEqual(["big", "small", "metric"]);
  });
});

describe("trackListBody — the `list` envelope is required, and the cursor goes inside it", () => {
  it("wraps the search and the window in the envelope the endpoint demands", () => {
    const body = trackListBody({ after: null, limit: 3, query: "service:x", window: { fromMs: 1000, toMs: 2000 } });
    expect(body).toEqual({ list: { limit: 3, search: { query: "service:x" }, time: { from: 1000, to: 2000 } } });
  });

  it("carries a cursor as `after` when one is given", () => {
    const body = trackListBody({ after: "AwAAA", limit: 1, query: "*", window: { fromMs: 1, toMs: 2 } });
    expect(body).toEqual({ list: { after: "AwAAA", limit: 1, search: { query: "*" }, time: { from: 1, to: 2 } } });
  });
});

describe("foldTwoLevel — a named thing with named things under it", () => {
  it("sums the outer count across its inner groups and keeps the inner ones as members", () => {
    const folded = foldTwoLevel({
      buckets: {
        buckets: [
          { by: { "@ci.job.name": "run", "@ci.pipeline.name": "PR checks" }, count: 57_954 },
          { by: { "@ci.job.name": "integration", "@ci.pipeline.name": "PR checks" }, count: 20_237 },
          { by: { "@ci.job.name": "Analyze", "@ci.pipeline.name": "CodeQL" }, count: 20_988 },
        ],
        trafficType: null,
        truncated: false,
      },
      innerFacet: "@ci.job.name",
      outerFacet: "@ci.pipeline.name",
    });
    expect(folded.map((one) => one.outer)).toEqual(["PR checks", "CodeQL"]);
    expect(folded[0]!.count).toBe(78_191);
    expect(folded[0]!.members.map((member) => member.name)).toEqual(["run", "integration"]);
  });

  it("drops a bucket whose outer facet the events did not carry", () => {
    const folded = foldTwoLevel({
      buckets: { buckets: [{ by: { "@ci.job.name": "run" }, count: 9 }], trafficType: null, truncated: false },
      innerFacet: "@ci.job.name",
      outerFacet: "@ci.pipeline.name",
    });
    expect(folded).toEqual([]);
  });
});

describe("trafficTypeFromMeta — the field the SDK models on no envelope", () => {
  it("reads the live spans reply's `sampled` out of additionalProperties", () => {
    expect(trafficTypeFromMeta({ meta: { additionalProperties: { traffic_type: "sampled" } } })).toBe("sampled");
  });

  it("answers nothing when the response carried no meta at all", () => {
    expect(trafficTypeFromMeta({ meta: undefined })).toBeNull();
  });

  it("answers nothing when meta carried no additionalProperties, which is every logs reply", () => {
    expect(trafficTypeFromMeta({ meta: { elapsed: 12 } })).toBeNull();
  });

  it("answers nothing for a traffic_type that is not a string, rather than coercing it", () => {
    expect(trafficTypeFromMeta({ meta: { additionalProperties: { traffic_type: 1 } } })).toBeNull();
  });
});

describe("spanBucketsFrom / bucketsFrom — truncation is judged on what came back, not what was kept", () => {
  const facets = [{ facet: "service", limit: 20 }];
  const services = Array.from({ length: 19 }, (_unused, index) => `svc-${index}`);

  it("calls a limit-sized spans answer truncated even when one bucket's count was unreadable and dropped", () => {
    const returned = [
      ...services.map((service) => ({ attributes: { by: { service }, compute: { c0: 1 } } })),
      { attributes: { by: { service: "unreadable" } } },
    ];
    const read = spanBucketsFrom({ facets, returned, trafficType: "sampled" });
    expect(read.buckets).toHaveLength(19);
    expect(read.truncated).toBe(true);
  });

  it("calls a short spans answer complete", () => {
    const returned = services.map((service) => ({ attributes: { by: { service }, compute: { c0: 1 } } }));
    expect(spanBucketsFrom({ facets, returned, trafficType: null }).truncated).toBe(false);
  });

  it("calls a limit-sized RUM/CI answer truncated even when one bucket was not a record and was dropped", () => {
    const raw = [...services.map((service) => ({ by: { service }, computes: { c0: 1 } })), "not a bucket"];
    const read = bucketsFrom({ facets, raw, trafficType: null });
    expect(read.buckets).toHaveLength(19);
    expect(read.truncated).toBe(true);
  });
});

describe("splitTag / foldMetricTags", () => {
  it("keeps a value that itself contains a colon whole", () => {
    expect(splitTag({ tag: "host:localhost:8080" })).toEqual({ key: "host", value: "localhost:8080" });
  });

  it("refuses a tag with no colon rather than inventing an empty value", () => {
    expect(splitTag({ tag: "bare" })).toBeNull();
  });

  it("counts a key's distinct values as its member count", () => {
    const folded = foldMetricTags({ tags: ["env:production", "env:staging", "host:a", "host:b", "host:c"] });
    expect(folded.members).toEqual([
      { count: 3, name: "host" },
      { count: 2, name: "env" },
    ]);
  });

  it("keeps the values of an allowlisted key and none of an unlisted one", () => {
    const folded = foldMetricTags({ tags: ["env:production", "pod_name:api-7f9"] });
    expect(folded.facets.map((facet) => facet.path)).toEqual(["env"]);
    expect(folded.facets[0]!.values).toEqual(["production"]);
  });
});

describe("unrunLines — a narrowed pass says which sections are simply absent", () => {
  it("says nothing when every product ran", () => {
    expect(unrunLines({ asked: CENSUS_PRODUCTS })).toEqual([]);
  });

  it("names the products that were not asked for, and says that is not the same as having none", () => {
    const lines = unrunLines({ asked: ["logs"] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toContain("spans");
    expect(lines[0]!).toContain("not the same as having none in Datadog");
  });
});

describe("mapBounded", () => {
  it("keeps the input order however the steps interleave", async () => {
    const out = await mapBounded({
      items: [30, 20, 10],
      limit: 3,
      run: async ({ item }) => {
        await new Promise((resolve) => setTimeout(resolve, item));
        return item;
      },
    });
    expect(out).toEqual([30, 20, 10]);
  });

  it("runs every item even when there are more items than lanes", async () => {
    const out = await mapBounded({ items: [1, 2, 3, 4, 5], limit: 2, run: async ({ item }) => item * 2 });
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("answers an empty list for no items rather than hanging on zero lanes", async () => {
    expect(await mapBounded({ items: [], limit: 4, run: async ({ item }) => item })).toEqual([]);
  });
});
