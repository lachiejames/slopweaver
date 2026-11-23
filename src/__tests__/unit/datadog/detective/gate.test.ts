/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import type { CensusRow } from "../../../../datadog/census/row.js";
import type { Catalogue } from "../../../../datadog/detective/catalogue.js";
import { MIN_KEYWORD_CHARS, probeCatalogue } from "../../../../datadog/detective/gate.js";

/** One census row, defaulted so a case names only the fields it is about. */
function row(over: Partial<CensusRow> = {}): CensusRow {
  return {
    count: 3,
    countFrom: "aggregate",
    envs: ["production"],
    exemplars: 2,
    facets: [{ distinct: 2, path: "err.code", values: ["P2028", "permission_denied"] }],
    firstSeenIso: "2026-09-13T00:00:00.000Z",
    identity: "9fe6556d87b8",
    key: "logs|jobs-api|9fe6556d87b8",
    label: "[handler] transaction <n> failed",
    lastSeenIso: "2026-09-13T01:00:00.000Z",
    members: [],
    membersTruncated: false,
    paths: [],
    product: "logs",
    query: 'service:"jobs-api" __dd.log_identity.raw_msg_fingerprint:9fe6556d87b8',
    service: "jobs-api",
    statuses: ["error"],
    template: "[handler] transaction <n> failed",
    ...over,
  };
}

/** A census shaped like a real one, small enough to reason about exactly. */
function catalogue(): Catalogue {
  return {
    manifest: {
      builtAtIso: "2026-09-16T00:00:00.000Z",
      map: {
        dashboards: [],
        edges: [],
        entities: [],
        indexes: [{ name: "main", retentionDays: 15 }],
        metricNamespaces: [{ names: 12, namespace: "gcp" }],
        monitors: [{ id: 1, name: "Partners sync failures", query: 'logs("status:error").last(5m)', type: "log" }],
        pipelines: [],
        rumApplications: [{ id: "app-1", name: "customer-ui", type: "browser" }],
      },
      notMeasured: [],
      products: [{ exemplified: 3, notMeasured: [], product: "logs", rows: 3 }],
      retentionDays: 15,
      rows: 3,
      schemaVersion: 2,
      services: [
        { events: 72_789, product: "logs", service: "acme-nightly-job-sync-partners" },
        { events: 1_787_197, product: "logs", service: "jobs-api" },
      ],
      site: "ap1.datadoghq.com",
      window: { fromIso: "2026-09-09T00:00:00.000Z", toIso: "2026-09-16T00:00:00.000Z" },
    },
    rows: [
      row(),
      row({
        identity: "postgresql.query|client",
        key: "spans|core-api|postgresql.query|client",
        label: "postgresql.query (client)",
        members: [{ count: 900, name: "SELECT * FROM Customer" }],
        product: "spans",
        service: "core-api",
      }),
      row({
        count: null,
        countFrom: "none",
        identity: "booking.create.route",
        key: "metrics|(none)|booking.create.route",
        label: "booking.create.route",
        product: "metrics",
        service: "(none)",
      }),
    ],
  };
}

describe("probeCatalogue — the gate that decides whether Datadog is worth a network call", () => {
  it("matches a keyword inside a service name, which is the owner's own worked example", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["partners"] });
    const services = verdict.hits.filter((hit) => hit.kind === "service").map((hit) => hit.matched);
    expect(services).toEqual(["acme-nightly-job-sync-partners"]);
  });

  it("puts the service hit ahead of the monitor hit the same keyword also produced", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["partners"] });
    expect(verdict.hits[0]!.kind).toBe("service");
  });

  it("matches an error code, where the keyword is the whole value rather than a substring of it", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["P2028"] });
    expect(verdict.hits.filter((hit) => hit.kind === "error-code").map((hit) => hit.matched)).toEqual(["P2028"]);
  });

  it("matches a log pattern by its own template, which the sampled catalogue could not do", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["transaction"] });
    const shapes = verdict.hits.filter((hit) => hit.kind === "shape");
    expect(shapes.map((hit) => hit.matched)).toEqual(["[handler] transaction <n> failed"]);
    expect(shapes[0]!.service).toBe("jobs-api");
  });

  it("matches a span operation and attributes it to the service that emits it", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["postgresql"] });
    const shape = verdict.hits.find((hit) => hit.kind === "shape")!;
    expect(shape.matched).toBe("postgresql.query (client)");
    expect(shape.service).toBe("core-api");
  });

  it("matches a metric by NAME, as its own stronger hit kind", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["booking.create.route"] });
    expect(verdict.hits.filter((hit) => hit.kind === "metric").map((hit) => hit.matched)).toEqual([
      "booking.create.route",
    ]);
  });

  it("matches a member underneath a row — a span resource, a job, a table", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["SELECT * FROM Customer"] });
    expect(verdict.hits.filter((hit) => hit.kind === "member").map((hit) => hit.matched)).toEqual([
      "SELECT * FROM Customer",
    ]);
  });

  it("orders the services to brief on by how much they emit", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["partners", "transaction"] });
    expect(verdict.services).toEqual(["jobs-api", "acme-nightly-job-sync-partners"]);
  });

  it("refuses a keyword too short to discriminate, and SAYS so rather than dropping it", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["db"] });
    expect(verdict.hits).toEqual([]);
    expect(verdict.skipped[0]!).toContain(`under ${String(MIN_KEYWORD_CHARS)} characters`);
  });

  it("answers no hits at all for a question Datadog has nothing to say about", () => {
    const verdict = probeCatalogue({ catalogue: catalogue(), keywords: ["procurement"] });
    expect(verdict.hits).toEqual([]);
    expect(verdict.services).toEqual([]);
  });

  it("collapses one keyword's repeated match on one thing into a single hit", () => {
    const twice: Catalogue = { ...catalogue(), rows: [row(), row({ key: "logs|jobs-api|other" })] };
    const verdict = probeCatalogue({ catalogue: twice, keywords: ["transaction"] });
    expect(verdict.hits.filter((hit) => hit.kind === "shape")).toHaveLength(1);
  });
});
