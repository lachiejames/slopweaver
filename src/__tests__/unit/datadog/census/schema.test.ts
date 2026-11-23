/**
 * The census's row schema and its track boundaries. The ROW schema pins every field and the two closed
 * vocabularies, so a stored line that is not a census row is refused rather than coerced. Each TRACK boundary
 * pins Datadog's envelope and event wrapper strictly and lets each event's own tree through untouched.
 */
import { describe, expect, it } from "vitest";

import type { BoundaryShapeChangedError } from "#lib/boundary.js";

import { TRACK_PAGE_BOUNDARIES, UNIFIED_TRACKS } from "../../../../datadog/census/boundaries.js";
import { censusRowSchema } from "../../../../datadog/census/schema.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A census row with every nullable field null and every list empty. */
const MINIMAL_ROW = {
  count: null,
  countFrom: "none",
  envs: [],
  exemplars: 0,
  facets: [],
  firstSeenIso: null,
  identity: "service:web",
  key: "logs:web",
  label: "web logs",
  lastSeenIso: null,
  members: [],
  membersTruncated: false,
  paths: [],
  product: "logs",
  query: "service:web",
  service: "web",
  statuses: [],
  template: null,
};

/** A census row with every field populated. */
const FULL_ROW = {
  count: 1200,
  countFrom: "aggregate",
  envs: ["prod", "staging"],
  exemplars: 3,
  facets: [
    { distinct: 2, path: "@http.method", values: ["GET", "POST"] },
    { distinct: 900, path: "@usr.id", values: null },
  ],
  firstSeenIso: "2026-10-01T00:00:00.000Z",
  identity: "service:api",
  key: "spans:api",
  label: "api spans",
  lastSeenIso: "2026-10-12T00:00:00.000Z",
  members: [{ count: 700, name: "GET /health" }],
  membersTruncated: true,
  paths: [{ path: "@duration", types: ["number"] }],
  product: "spans",
  query: "service:api",
  service: "api",
  statuses: ["ok", "error"],
  template: "GET /<path>",
};

/**
 * The paths of every issue a refused row raised, read off the error arm without a branch.
 *
 * @returns each issue's dotted path
 */
function rowIssuePaths({ row }: { row: unknown }): readonly string[] {
  const parsed = censusRowSchema.safeParse(row);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => issue.path.join("."));
}

/**
 * Every drift the trace boundary refused a page with, as `kind path`.
 *
 * @returns each drift's kind and dotted path
 */
function pageDrift({ page }: { page: unknown }): readonly string[] {
  const refusal = unwrapErr(TRACK_PAGE_BOUNDARIES.trace.parse({ value: page }));
  expect(refusal.code).toBe("BOUNDARY_SHAPE_CHANGED");
  return (refusal as BoundaryShapeChangedError).drift.map((drift) => `${drift.kind} ${drift.path}`);
}

describe("censusRowSchema", () => {
  it("parses a minimal row with every nullable field null, unchanged", () => {
    expect(censusRowSchema.parse(MINIMAL_ROW)).toEqual(MINIMAL_ROW);
  });

  it("parses a fully populated row, nested facets and members included, unchanged", () => {
    expect(censusRowSchema.parse(FULL_ROW)).toEqual(FULL_ROW);
  });

  it("refuses a product outside the closed census vocabulary", () => {
    expect(rowIssuePaths({ row: { ...MINIMAL_ROW, product: "events" } })).toEqual(["product"]);
  });

  it("refuses a countFrom outside aggregate, page and none", () => {
    expect(rowIssuePaths({ row: { ...MINIMAL_ROW, countFrom: "estimate" } })).toEqual(["countFrom"]);
  });

  it("refuses a member missing its name, a leaf path missing its types, and a facet missing its path", () => {
    const row = {
      ...MINIMAL_ROW,
      facets: [{ distinct: 1, values: null }],
      members: [{ count: 1 }],
      paths: [{ path: "@x" }],
    };

    expect(rowIssuePaths({ row })).toEqual(["facets.0.path", "members.0.name", "paths.0.types"]);
  });

  it("refuses null where a field is not nullable, and absence where one is", () => {
    const { template: _dropped, ...withoutTemplate } = MINIMAL_ROW;

    expect(rowIssuePaths({ row: { ...MINIMAL_ROW, label: null } })).toEqual(["label"]);
    expect(rowIssuePaths({ row: withoutTemplate })).toEqual(["template"]);
  });
});

/** A page as measured on every track: two wrapped events and a cursor. */
const MEASURED_PAGE = {
  elapsed: 120,
  hitCount: 2,
  requestId: "example-request-id",
  result: {
    count: 2,
    events: [
      {
        "datadog.index": "main",
        event: { attributes: { nested: { deep: [1, "two", null] } } },
        event_id: "e1",
        id: "i1",
      },
      { event: "a bare string event", id: "i2" },
    ],
    paging: { after: "cursor-abc", values: ["v"] },
  },
  status: "done",
  type: "trace",
};

describe("TRACK_PAGE_BOUNDARIES", () => {
  it("declares exactly one boundary per unified track, each naming its own route", () => {
    expect(UNIFIED_TRACKS.length).toBeGreaterThan(0);
    expect(Object.keys(TRACK_PAGE_BOUNDARIES).toSorted()).toEqual(UNIFIED_TRACKS.toSorted());
    expect(UNIFIED_TRACKS.map((track) => TRACK_PAGE_BOUNDARIES[track].endpoint)).toEqual(
      UNIFIED_TRACKS.map((track) => `POST /api/v1/logs-analytics/list?type=${track}`),
    );
  });

  it("admits the measured page, passing each event's own tree through untouched", () => {
    expect(unwrap(TRACK_PAGE_BOUNDARIES.trace.parse({ value: MEASURED_PAGE }))).toEqual(MEASURED_PAGE);
  });

  it("admits a last page, which carries no paging at all", () => {
    const last = { hitCount: 0, result: { count: 0, events: [] } };
    expect(unwrap(TRACK_PAGE_BOUNDARIES.logs.parse({ value: last }))).toEqual(last);
  });

  it("refuses a key Datadog adds at every pinned level, by name", () => {
    const result = MEASURED_PAGE.result;
    expect(pageDrift({ page: { ...MEASURED_PAGE, added: 1 } })).toEqual(["new added"]);
    expect(pageDrift({ page: { ...MEASURED_PAGE, result: { ...result, added: 1 } } })).toEqual(["new result.added"]);
    expect(pageDrift({ page: { ...MEASURED_PAGE, result: { ...result, paging: { added: 1, after: "c" } } } })).toEqual([
      "new result.paging.added",
    ]);
    expect(
      pageDrift({ page: { ...MEASURED_PAGE, result: { ...result, events: [{ added: 1, event: {}, id: "i1" }] } } }),
    ).toEqual(["new result.events[0].added"]);
  });

  it("refuses a page with no result envelope, and a numeric cursor", () => {
    expect(pageDrift({ page: { hitCount: 0 } })).toEqual(["missing result"]);
    expect(
      pageDrift({ page: { ...MEASURED_PAGE, result: { ...MEASURED_PAGE.result, paging: { after: 42 } } } }),
    ).toEqual(["changed result.paging.after"]);
  });

  it("names the drifted track's own route in the refusal", () => {
    const refusal = unwrapErr(TRACK_PAGE_BOUNDARIES.rum.parse({ value: { hitCount: 0 } }));
    expect(refusal.message).toContain("POST /api/v1/logs-analytics/list?type=rum");
  });
});
