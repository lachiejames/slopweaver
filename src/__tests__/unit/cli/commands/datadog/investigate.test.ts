/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { investigateLines, parseInvestigateArgs } from "../../../../../cli/commands/datadog/investigateCore.js";
import { investigateUsage } from "../../../../../cli/commands/datadog/usage.js";
import type { TrackEvent } from "../../../../../datadog/census/event.js";
import { auditBucketPartition } from "../../../../../datadog/counting.js";
import type { Catalogue } from "../../../../../datadog/detective/catalogue.js";
import { INDEXED_SPANS_CAVEAT, labelCount } from "../../../../../datadog/domain.js";
import { SAMPLED_CORROBORATION_HINT } from "../../../../../datadog/investigate/counts.js";
import {
  foldPageGroups,
  type InvestigateResult,
  issuedQuery,
  labelFor,
  rowOf,
} from "../../../../../datadog/investigate/run.js";
import { INVESTIGATE_PRODUCTS, investigateSpec } from "../../../../../datadog/investigate/spec.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../../../../lib/safeJson.js";

/** A census holding one labelled log pattern, so the label join can be tested exactly. */
function catalogue(): Catalogue {
  return {
    manifest: {
      builtAtIso: "2026-09-16T00:00:00.000Z",
      map: {
        dashboards: [],
        edges: [],
        entities: [],
        indexes: [],
        metricNamespaces: [],
        monitors: [],
        pipelines: [],
        rumApplications: [],
      },
      notMeasured: [],
      products: [],
      retentionDays: 15,
      rows: 1,
      schemaVersion: 2,
      services: [],
      site: "ap1.datadoghq.com",
      window: { fromIso: "2026-09-09T00:00:00.000Z", toIso: "2026-09-16T00:00:00.000Z" },
    },
    rows: [
      {
        count: 861_782,
        countFrom: "aggregate",
        envs: ["production"],
        exemplars: 3,
        facets: [],
        firstSeenIso: "2026-09-15T00:00:00.000Z",
        identity: "96dedf596944",
        key: "logs|jobs-api|96dedf596944",
        label: "[handler] transaction <n> failed",
        lastSeenIso: "2026-09-15T01:00:00.000Z",
        members: [],
        membersTruncated: false,
        paths: [],
        product: "logs",
        query: "service:jobs-api",
        service: "jobs-api",
        statuses: ["error"],
        template: "[handler] transaction <n> failed",
      },
    ],
  };
}

/** One result, defaulted so a case names only the fields it is about. */
function result(over: Partial<InvestigateResult> = {}): InvestigateResult {
  return {
    corroborate: null,
    countLabel: { caveats: [], kind: "count", statedAs: "events" },
    groupedBy: ["service", "status"],
    groups: [{ by: { service: "jobs-api", status: "error" }, count: 40, label: null }],
    groupsFromPage: false,
    notes: [],
    partition: null,
    product: "logs",
    query: "*",
    rows: [],
    total: 100,
    truncated: false,
    window: { fromMs: 1_789_500_000_000, toMs: 1_789_503_600_000 },
    ...over,
  };
}

describe("investigateSpec — one declaration per verb", () => {
  it("declares every product the verb list names", () => {
    expect(INVESTIGATE_PRODUCTS.length).toBeGreaterThan(0);
    expect(INVESTIGATE_PRODUCTS.map((product) => investigateSpec({ product }).product)).toEqual([
      ...INVESTIGATE_PRODUCTS,
    ]);
  });

  it("counts the two products with no analytics endpoint from the track instead", () => {
    expect(investigateSpec({ product: "dbm" }).countedBy).toBe("track");
    expect(investigateSpec({ product: "profiles" }).countedBy).toBe("track");
  });
});

describe("issuedQuery — the noise filter is a negation on the query itself", () => {
  it("negates every exclusion onto the query", () => {
    expect(issuedQuery({ excludes: ["status:info", "service:jobs-api"], query: "@err.code:P2028" })).toBe(
      "@err.code:P2028 -(status:info) -(service:jobs-api)",
    );
  });

  it("asks for everything when the caller named no query at all", () => {
    expect(issuedQuery({ excludes: [], query: "   " })).toBe("*");
  });
});

describe("parseInvestigateArgs", () => {
  it("takes the query positionally, the way a person types one", () => {
    expect(unwrap(parseInvestigateArgs({ rest: ["service:core-api", "status:error"] })).query).toBe(
      "service:core-api status:error",
    );
  });

  it("prints counts only until --rows asks for events", () => {
    expect(unwrap(parseInvestigateArgs({ rest: [] })).rows).toBe(0);
    expect(unwrap(parseInvestigateArgs({ rest: ["--rows", "5"] })).rows).toBe(5);
  });

  it("refuses a bare --rows rather than guessing how many events to print", () => {
    expect(unwrapErr(parseInvestigateArgs({ rest: ["--rows"] })).message).toContain("requires a value");
  });

  it("refuses a row count that is not a whole number", () => {
    expect(unwrapErr(parseInvestigateArgs({ rest: ["--rows", "lots"] })).message).toContain("whole number");
  });

  it("reads the facet and exclusion lists", () => {
    const args = unwrap(parseInvestigateArgs({ rest: ["--by", "service,@err.code", "--not", "status:info"] }));
    expect(args.facets).toEqual(["service", "@err.code"]);
    expect(args.excludes).toEqual(["status:info"]);
  });
});

describe("labelFor — a hex fingerprint becomes the message it stands for", () => {
  it("labels a group from the census row whose identity it names", () => {
    expect(labelFor({ catalogue: catalogue(), identity: "96dedf596944", product: "logs" })).toBe(
      "[handler] transaction <n> failed",
    );
  });

  it("answers nothing when no census has been built, rather than failing", () => {
    expect(labelFor({ catalogue: null, identity: "96dedf596944", product: "logs" })).toBeNull();
  });

  it("answers nothing for an identity the census does not hold", () => {
    expect(labelFor({ catalogue: catalogue(), identity: "deadbeef", product: "logs" })).toBeNull();
  });
});

describe("foldPageGroups / rowOf", () => {
  const event = (over: Partial<TrackEvent["attributes"]> = {}): TrackEvent => ({
    attributes: { service: "jobs-api", status: "error", ...over },
    message: null,
    occurredAtIso: "2026-09-15T10:00:00.000Z",
  });

  it("counts the groups a page held, biggest first", () => {
    const groups = foldPageGroups({
      events: [event(), event(), event({ service: "core-api" })],
      facets: ["service"],
    });
    expect(groups.map((group) => ({ count: group.count, service: group.by["service"] }))).toEqual([
      { count: 2, service: "jobs-api" },
      { count: 1, service: "core-api" },
    ]);
  });

  it("prints a database query by its SIGNATURE, never by its statement", () => {
    const row = rowOf({
      event: event({ "@db.query_signature": "a1b2c3", "@db.statement": "SELECT * FROM Customer WHERE id = 42" }),
    });
    expect(row.text).toBe("query signature a1b2c3");
  });

  it("prints a span by its resource", () => {
    expect(rowOf({ event: event({ resource_name: "POST /v1/sessions" }) }).text).toBe("POST /v1/sessions");
  });

  it("prints the event's own service and status when it carries them", () => {
    const row = rowOf({ event: event() });
    expect(row.service).toBe("jobs-api");
    expect(row.status).toBe("error");
  });

  it("marks a column the event carries no reserved attribute for, rather than leaving it blank", () => {
    const row = rowOf({
      event: { attributes: { "@ci.status": "success" }, message: null, occurredAtIso: "2026-09-15T10:00:00.000Z" },
    });
    expect(row.service).toBe("(none)");
    expect(row.status).toBe("(none)");
  });

  it("marks an empty-string attribute the same way, since the track reader treats it as absent", () => {
    const row = rowOf({ event: event({ service: "", status: "" }) });
    expect(row.service).toBe("(none)");
    expect(row.status).toBe("(none)");
  });
});

describe("investigateLines — counts first, events only when asked", () => {
  it("leads with the total and the query as issued", () => {
    const lines = investigateLines({ result: result({ query: "status:error -(service:jobs-api)" }) });
    expect(lines[0]!).toContain("100 event(s)");
    expect(lines[1]!).toBe("  query: status:error -(service:jobs-api)");
  });

  it("shows each group's share of the total", () => {
    expect(investigateLines({ result: result() }).join("\n")).toContain("40.0%");
  });

  it("names the next move when no events were printed", () => {
    expect(investigateLines({ result: result() }).join("\n")).toContain("--not");
  });

  it("prints the label a census supplied under the group", () => {
    const lines = investigateLines({
      result: result({
        groups: [{ by: { service: "jobs-api" }, count: 40, label: "[handler] transaction <n> failed" }],
      }),
    });
    expect(lines.join("\n")).toContain("[handler] transaction <n> failed");
  });

  it("prints the events when rows came back, after the counts", () => {
    const lines = investigateLines({
      result: result({
        rows: [{ occurredAtIso: "2026-09-15T10:00:00.000Z", service: "jobs-api", status: "error", text: "boom" }],
      }),
    });
    expect(lines.join("\n")).toContain("boom");
    expect(lines.join("\n").indexOf("40")).toBeLessThan(lines.join("\n").indexOf("boom"));
  });

  it("states a note in full rather than truncating it", () => {
    const lines = investigateLines({ result: result({ notes: ["the dbm counts — not read: HTTP 403"] }) });
    expect(lines).toContain("  the dbm counts — not read: HTTP 403");
  });
});

describe("investigateLines — what each reported figure may be read as", () => {
  /** The live apm shape: a domain-sampled total over the measured window. */
  const sampledApm = (over: Partial<InvestigateResult> = {}): InvestigateResult =>
    result({
      corroborate: SAMPLED_CORROBORATION_HINT,
      countLabel: unwrap(
        labelCount({ allowSampled: true, evidence: { domain: "spans", kind: "known-domain" }, measure: "count" }),
      ),
      groupedBy: ["service"],
      groups: [{ by: { service: "jobs-api" }, count: 40, label: null }],
      product: "apm",
      query: "env:(prod OR production) status:error",
      ...over,
    });

  it("qualifies a sampled apm total in its header, states its caveat and points at logs to corroborate", () => {
    const lines = investigateLines({ result: sampledApm() });
    expect(lines.slice(0, 4)).toEqual([
      "datadog apm — 100 event(s) over 2026-09-15T19:20:00.000Z .. 2026-09-15T20:20:00.000Z — count over sampled traffic — a lower bound, not a total",
      "  query: env:(prod OR production) status:error",
      `  caveat: ${INDEXED_SPANS_CAVEAT}`,
      `  corroborate: ${SAMPLED_CORROBORATION_HINT}`,
    ]);
    expect(lines.join("\n")).toContain("sampled traffic");
  });

  it("prints the measured inflated run as NOT a count, with no share on any group", () => {
    const groups = [
      { by: { service: "jobs-api" }, count: 308_874, label: null },
      { by: { service: "core-api" }, count: 195_268, label: null },
    ];
    const partition = auditBucketPartition({ buckets: groups, facet: "service", total: 206_474 });
    const lines = investigateLines({ result: sampledApm({ groups, partition, total: 206_474 }) });
    expect(partition.bucketed).toBe(504_142);
    expect(lines.slice(4)).toEqual([
      "  grouped by service",
      "  NOT a count of events: the 'service' buckets sum to 504142 against only 206474 matched events, an excess of 297668, so they do not establish a one-event-once partition",
      "    308,874          service:jobs-api",
      "    195,268          service:core-api",
      "",
      "  next: --not '<clause>' to cut a group out of the count, --by <facet,facet> to regroup, --rows <n> to read events",
    ]);
    expect(lines.join("\n")).not.toContain("%");
    expect(lines.join("\n")).not.toContain("149.6");
  });

  it("states a residual's shortfall and keeps each group's share", () => {
    const groups = [{ by: { service: "jobs-api" }, count: 40, label: null }];
    const partition = auditBucketPartition({ buckets: groups, facet: "service", total: 100 });
    const lines = investigateLines({ result: result({ groupedBy: ["service"], groups, partition }) });
    expect(lines.slice(2, 4)).toEqual([
      "  grouped by service",
      "  the 'service' buckets are short by 60: they sum to 40 against 100 matched events, so 60 appear in no bucket",
    ]);
    expect(lines[4]!).toContain("(40.0%)");
  });

  it("leaves a plain logs count exactly as it was: ordinary header and share, no caveat, no hint", () => {
    const lines = investigateLines({ result: result() });
    expect(lines.slice(0, 4)).toEqual([
      "datadog logs — 100 event(s) over 2026-09-15T19:20:00.000Z .. 2026-09-15T20:20:00.000Z",
      "  query: *",
      "  grouped by service × status",
      "         40 (40.0%)  service:jobs-api  status:error",
    ]);
    expect(lines.join("\n")).not.toContain("caveat");
    expect(lines.join("\n")).not.toContain("corroborate");
  });

  it("carries the label, the audit and the corroboration hint through the --json document", () => {
    const partition = auditBucketPartition({ buckets: [{ by: {}, count: 100 }], facet: "service", total: 100 });
    const document = safeJsonStringify({ label: "investigate result", value: sampledApm({ partition }) });
    const parsed = safeJsonParse({ label: "investigate result", text: document });
    expect(parsed).toMatchObject({
      corroborate: SAMPLED_CORROBORATION_HINT,
      countLabel: { kind: "sampled-count", statedAs: "count over sampled traffic — a lower bound, not a total" },
      partition: { bucketed: 100, total: 100, verdict: "partition" },
    });
    const plain = safeJsonParse({
      label: "investigate result",
      text: safeJsonStringify({ label: "investigate result", value: result() }),
    });
    expect(plain).toMatchObject({ corroborate: null });
  });
});

describe("investigateUsage", () => {
  it("names the product's own default grouping, so --help says what a bare call does", () => {
    expect(investigateUsage({ product: "apm" })).toContain("service, operation_name, resource_name");
  });
});
