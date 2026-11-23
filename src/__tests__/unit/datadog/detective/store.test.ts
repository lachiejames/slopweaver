/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CensusRow } from "../../../../datadog/census/row.js";
import type { Catalogue } from "../../../../datadog/detective/catalogue.js";
import { catalogueExists, readCatalogue, writeCatalogue } from "../../../../datadog/detective/store.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

/** A throwaway home, removed after the test that minted it. */
function mintHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dd-census-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** One census row, fully populated, so a schema that lost a field fails rather than silently dropping it. */
function row(): CensusRow {
  return {
    count: 861_782,
    countFrom: "aggregate",
    envs: ["production", "staging"],
    exemplars: 3,
    facets: [{ distinct: 2, path: "status", values: ["error", "warn"] }],
    firstSeenIso: "2026-09-13T14:03:25.000Z",
    identity: "9fe6556d87b8",
    key: "logs|core-api|9fe6556d87b8",
    label: "[sessionTypeForBooking] booking type absent",
    lastSeenIso: "2026-09-13T16:10:54.000Z",
    members: [{ count: 12, name: "Customer" }],
    membersTruncated: true,
    paths: [{ path: "@bookingType", types: ["null", "string"] }],
    product: "logs",
    query: 'service:"core-api" __dd.log_identity.raw_msg_fingerprint:9fe6556d87b8',
    service: "core-api",
    statuses: ["error"],
    template: "[sessionTypeForBooking] booking type absent",
  };
}

/** A whole census, every map list non-empty, for the same reason. */
function catalogue(): Catalogue {
  return {
    manifest: {
      builtAtIso: "2026-09-16T02:05:00.000Z",
      map: {
        dashboards: [{ id: "abc-123", title: "Jobs overview" }],
        edges: [{ operation: "postgresql.query", service: "jobs-api", spans: 19_800_000 }],
        entities: [{ kind: "service", name: "jobs-api", owner: "platform" }],
        indexes: [{ name: "main", retentionDays: 15 }],
        metricNamespaces: [{ names: 412, namespace: "trace" }],
        monitors: [{ id: 969_248, name: "jobs-api errors", query: 'logs("status:error").last(5m)', type: "log" }],
        pipelines: [{ enabled: true, id: "pipe-1", name: "nodejs" }],
        rumApplications: [{ id: "app-1", name: "customer-ui", type: "browser" }],
      },
      notMeasured: ["jobs-api wrote more than 10000 distinct error log patterns in this window"],
      products: [{ exemplified: 1, notMeasured: [], product: "logs", rows: 1 }],
      retentionDays: 15,
      rows: 1,
      schemaVersion: 2,
      services: [{ events: 18_808_434, product: "logs", service: "jobs-api" }],
      site: "ap1.datadoghq.com",
      window: { fromIso: "2026-09-09T02:05:00.000Z", toIso: "2026-09-16T02:05:00.000Z" },
    },
    rows: [row()],
  };
}

describe("catalogueExists", () => {
  it("is false on a home nothing has been built under", () => {
    expect(catalogueExists({ home: mintHome() })).toBe(false);
  });

  it("is true once both files are there", () => {
    const home = mintHome();
    writeCatalogue({ catalogue: catalogue(), home });
    expect(catalogueExists({ home })).toBe(true);
  });
});

describe("writeCatalogue / readCatalogue — a round trip that a lost field fails", () => {
  it("reads back exactly what was written, manifest and rows alike", () => {
    const home = mintHome();
    const written = catalogue();
    writeCatalogue({ catalogue: written, home });
    const read = unwrap(readCatalogue({ home }));
    expect(read.manifest).toEqual(written.manifest);
    expect(read.rows).toEqual(written.rows);
  });

  it("reports an ABSENT census as its own code, because that is a routing fact rather than a fault", () => {
    const failure = readCatalogue({ home: mintHome() });
    expect(failure.isErr()).toBe(true);
    expect(failure._unsafeUnwrapErr().code).toBe("CATALOGUE_ABSENT");
  });

  it("fails the WHOLE read on one malformed row, never returning the rows it could parse", () => {
    const home = mintHome();
    writeCatalogue({ catalogue: catalogue(), home });
    const paths = stateHomePaths({ home }).datadogCatalogue;
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.rows, `${JSON.stringify({ key: "logs|core-api|x" })}\n`, "utf8");
    const failure = readCatalogue({ home });
    expect(failure.isErr()).toBe(true);
    expect(failure._unsafeUnwrapErr().code).toBe("CATALOGUE_UNREADABLE");
  });

  it("refuses a manifest from the sampling schema it replaced rather than reading it as a thin census", () => {
    const home = mintHome();
    const paths = stateHomePaths({ home }).datadogCatalogue;
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(
      paths.manifest,
      JSON.stringify({ builtAtIso: "2026-09-14T01:45:32.077Z", schemaVersion: 1, shapes: 162, volumes: [] }),
      "utf8",
    );
    const failure = readCatalogue({ home });
    expect(failure.isErr()).toBe(true);
    expect(failure._unsafeUnwrapErr().code).toBe("CATALOGUE_UNREADABLE");
  });
});
