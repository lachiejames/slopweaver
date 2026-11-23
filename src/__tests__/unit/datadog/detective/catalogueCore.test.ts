/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  countLine,
  parseCatalogueArgs,
  parseCatalogueBuildArgs,
  parseCatalogueShowArgs,
  parseProducts,
  selectRows,
  showLines,
} from "../../../../cli/commands/datadog/catalogueCore.js";
import { DatadogArgsErrors } from "../../../../cli/commands/datadog/errors.js";
import { CENSUS_PRODUCTS } from "../../../../datadog/census/product.js";
import type { CensusRow } from "../../../../datadog/census/row.js";
import type { Catalogue } from "../../../../datadog/detective/catalogue.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One row, defaulted so a case names only the fields it is about. */
function row(over: Partial<CensusRow> = {}): CensusRow {
  return {
    count: 12,
    countFrom: "aggregate",
    envs: ["production"],
    exemplars: 1,
    facets: [],
    firstSeenIso: "2026-09-15T00:00:00.000Z",
    identity: "id",
    key: "logs|core-api|id",
    label: "[sessionTypeForBooking] absent",
    lastSeenIso: "2026-09-15T01:00:00.000Z",
    members: [],
    membersTruncated: false,
    paths: [],
    product: "logs",
    query: 'service:"core-api"',
    service: "core-api",
    statuses: ["info"],
    template: null,
    ...over,
  };
}

/** A census with three rows across two products, for the selection cases. */
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
      rows: 3,
      schemaVersion: 2,
      services: [],
      site: "ap1.datadoghq.com",
      window: { fromIso: "2026-09-09T00:00:00.000Z", toIso: "2026-09-16T00:00:00.000Z" },
    },
    rows: [
      row(),
      row({ key: "spans|jobs-api|op", label: "postgresql.query (client)", product: "spans", service: "jobs-api" }),
      row({ key: "logs|jobs-api|other", label: "[worker] queue drained", service: "jobs-api" }),
    ],
  };
}

describe("parseProducts", () => {
  it("falls back to every product, which is the owner's 'everything is in scope'", () => {
    expect(unwrap(parseProducts({ fallback: CENSUS_PRODUCTS, raw: undefined }))).toEqual(CENSUS_PRODUCTS);
  });

  it("reads a comma-separated list", () => {
    expect(unwrap(parseProducts({ fallback: [], raw: "logs,spans" }))).toEqual(["logs", "spans"]);
  });

  it("REFUSES an unknown product rather than ignoring it", () => {
    expect(unwrapErr(parseProducts({ fallback: [], raw: "traces" }))[0]!).toContain("not one of");
  });
});

describe("parseCatalogueBuildArgs", () => {
  it("defaults to a seven-day window and every product", () => {
    const args = unwrap(parseCatalogueBuildArgs({ rest: [] }));
    expect(args.from).toBe("7d");
    expect(args.to).toBe("now");
    expect(args.products).toEqual(CENSUS_PRODUCTS);
  });

  it("narrows to the products a caller names", () => {
    expect(unwrap(parseCatalogueBuildArgs({ rest: ["--product", "dbm"] })).products).toEqual(["dbm"]);
  });

  it("has no cell ceiling to read at all, by the owner's standing steer", () => {
    expect(unwrapErr(parseCatalogueBuildArgs({ rest: ["--max-cells", "24"] }))[0]!).toContain("max-cells");
  });
});

describe("parseCatalogueShowArgs", () => {
  it("defaults the limit and leaves every filter unset", () => {
    const args = unwrap(parseCatalogueShowArgs({ rest: [] }));
    expect(args.limit).toBe(20);
    expect(args.service).toBeUndefined();
    expect(args.product).toBeUndefined();
    expect(args.query).toBeUndefined();
  });

  it("refuses a limit that is not a whole number, quoting what the caller typed", () => {
    expect(unwrapErr(parseCatalogueShowArgs({ rest: ["--limit", "half"] }))[0]!).toContain("whole number");
  });
});

describe("parseCatalogueArgs — the one dispatcher both the verb and the help ratchet use", () => {
  it("routes build and show to their own parsers", () => {
    expect(unwrap(parseCatalogueArgs({ rest: ["build", "--from", "1d"] })).mode).toBe("build");
    expect(unwrap(parseCatalogueArgs({ rest: ["show", "--limit", "3"] })).mode).toBe("show");
  });

  it("refuses a sub-verb that is neither", () => {
    expect(unwrapErr(parseCatalogueArgs({ rest: ["rebuild"] }))).toEqual(
      DatadogArgsErrors.catalogueModeUnknown({ got: "rebuild" }),
    );
    expect(unwrapErr(parseCatalogueArgs({ rest: ["rebuild"] })).message).toContain('expected "build" or "show"');
  });

  it("refuses no sub-verb at all, saying it got nothing", () => {
    expect(unwrapErr(parseCatalogueArgs({ rest: [] })).message).toBe(
      'datadog catalogue: expected "build" or "show", got nothing',
    );
  });

  it("carries a half's own refusals as its reasons, one per line", () => {
    const error = unwrapErr(parseCatalogueArgs({ rest: ["show", "--limit", "half"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toBe('--limit must be a whole number of at least 1, not "half"');
  });
});

describe("selectRows", () => {
  it("filters by service", () => {
    const rows = selectRows({
      args: { home: undefined, json: false, limit: 10, product: undefined, query: undefined, service: "jobs-api" },
      catalogue: catalogue(),
    });
    expect(rows.map((one) => one.key)).toEqual(["spans|jobs-api|op", "logs|jobs-api|other"]);
  });

  it("filters by product", () => {
    const rows = selectRows({
      args: { home: undefined, json: false, limit: 10, product: "spans", query: undefined, service: undefined },
      catalogue: catalogue(),
    });
    expect(rows.map((one) => one.key)).toEqual(["spans|jobs-api|op"]);
  });

  it("filters by a label fragment, case-insensitively, which is what makes show read like a search", () => {
    const rows = selectRows({
      args: { home: undefined, json: false, limit: 10, product: undefined, query: "QUEUE", service: undefined },
      catalogue: catalogue(),
    });
    expect(rows.map((one) => one.key)).toEqual(["logs|jobs-api|other"]);
  });
});

describe("countLine — the two cases where a count is not the window's total", () => {
  it("states an aggregate count as the window's own", () => {
    expect(countLine({ row: row({ count: 861_782 }) })).toContain("in the window");
  });

  it("says a page-derived count is a FLOOR", () => {
    expect(countLine({ row: row({ count: 12, countFrom: "page" }) })).toContain("a floor");
  });

  it("says a metric has no event count at all rather than reporting zero", () => {
    expect(countLine({ row: row({ count: null, countFrom: "none", product: "metrics" }) })).toContain("no event count");
  });
});

describe("showLines", () => {
  it("prints the not-measured lines in full, because a census whose gaps are invisible misleads", () => {
    const withGap: Catalogue = {
      ...catalogue(),
      manifest: { ...catalogue().manifest, notMeasured: ["the RUM application listing — not read: HTTP 403"] },
    };
    const lines = showLines({
      args: { home: undefined, json: false, limit: 1, product: undefined, query: undefined, service: undefined },
      catalogue: withGap,
    });
    expect(lines).toContain("  the RUM application listing — not read: HTTP 403");
  });
});
