/**
 * The catalogue file's two schemas: a fully populated manifest and a cached record each parse back to exactly
 * what was written, the record's `attributes` tree passing through whatever shape Datadog gave it, while a
 * product or family outside the closed vocabularies and a missing envelope field are refused at their path.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { catalogueManifestSchema, datadogRecordSchema } from "../../../../datadog/detective/schema.js";

/** A manifest with every nested collection populated, nullable fields exercised on both sides. */
const MANIFEST = {
  builtAtIso: "2026-10-01T00:00:00.000Z",
  map: {
    dashboards: [{ id: "abc-123", title: "API latency" }],
    edges: [{ operation: "http.request", service: "api", spans: 412 }],
    entities: [
      { kind: "service", name: "api", owner: "platform" },
      { kind: "service", name: "worker", owner: null },
    ],
    indexes: [
      { name: "main", retentionDays: 15 },
      { name: "audit", retentionDays: null },
    ],
    metricNamespaces: [{ names: 37, namespace: "trace" }],
    monitors: [{ id: 9001, name: "5xx rate", query: "sum:http.5xx{*}", type: "metric alert" }],
    pipelines: [{ enabled: false, id: "p-1", name: "nginx" }],
    rumApplications: [{ id: "rum-1", name: "web", type: "browser" }],
  },
  notMeasured: ["dbm"],
  products: [
    { exemplified: 3, notMeasured: [], product: "logs", rows: 120 },
    { exemplified: 0, notMeasured: ["no exemplar fetched"], product: "ci-tests", rows: 0 },
  ],
  retentionDays: null,
  rows: 120,
  schemaVersion: 2,
  services: [{ events: 98, product: "spans", service: "api" }],
  site: "datadoghq.com",
  window: { fromIso: "2026-09-24T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z" },
};

/** One cached event with an arbitrary nested attribute tree. */
const RECORD = {
  attributes: { http: { status_code: 502, headers: ["x-a", "x-b"] }, tags: { team: null } },
  env: "prod",
  family: "rum-error",
  id: "AQAAAY",
  link: "https://app.datadoghq.com/logs?event=AQAAAY",
  occurredAtIso: "2026-10-01T03:04:05.000Z",
  service: "web",
  status: null,
  text: "TypeError: x is undefined",
};

/** The issues of a refused parse, thrown on an accepted one so a test cannot read a success as a failure. */
function issuesOf({ result }: { result: z.ZodSafeParseResult<unknown> }): readonly { path: readonly PropertyKey[] }[] {
  if (result.success) {
    throw new Error("expected the parse to be refused");
  }
  return result.error.issues.map((issue) => ({ path: issue.path }));
}

describe("catalogueManifestSchema", () => {
  it("parses a fully populated manifest back to exactly the input", () => {
    expect(catalogueManifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
  });

  it("refuses a product outside the census vocabulary, at that product's path", () => {
    const result = catalogueManifestSchema.safeParse({
      ...MANIFEST,
      products: [{ exemplified: 0, notMeasured: [], product: "synthetics", rows: 0 }],
    });

    expect(issuesOf({ result })).toEqual([{ path: ["products", 0, "product"] }]);
  });

  it("refuses a manifest missing its site", () => {
    const { site: _site, ...withoutSite } = MANIFEST;

    expect(issuesOf({ result: catalogueManifestSchema.safeParse(withoutSite) })).toEqual([{ path: ["site"] }]);
  });
});

describe("datadogRecordSchema", () => {
  it("parses a record back to exactly the input, its nested attributes untouched", () => {
    expect(datadogRecordSchema.parse(RECORD)).toEqual(RECORD);
  });

  it("refuses a family outside the shape-family vocabulary, at the family path", () => {
    expect(issuesOf({ result: datadogRecordSchema.safeParse({ ...RECORD, family: "trace" }) })).toEqual([
      { path: ["family"] },
    ]);
  });
});
