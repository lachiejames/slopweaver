import { describe, expect, it } from "vitest";

import type { TrackEvent } from "../../../../datadog/census/event.js";
import { foldPageProduct, type PageProductSpec } from "../../../../datadog/census/tracks.js";

/** Two database-query events of one signature plus one of another, as the track returns them. */
function dbEvents(): readonly TrackEvent[] {
  return [
    {
      attributes: {
        "@db.instance": "production-acme-postgres",
        "@db.metadata.tables": ["Customer", "Observation"],
        "@db.query_signature": "a1b2c3",
        "@db.rows": 12,
        "@db.statement": "SELECT * FROM Customer WHERE email = 'someone@example.com'",
        "@network.client.ip": "10.1.2.3",
        status: "info",
      },
      message: null,
      occurredAtIso: "2026-09-15T10:00:00.000Z",
    },
    {
      attributes: {
        "@db.instance": "production-acme-postgres",
        "@db.metadata.tables": ["Customer"],
        "@db.query_signature": "a1b2c3",
        "@db.rows": 3,
        status: "info",
      },
      message: null,
      occurredAtIso: "2026-09-15T11:00:00.000Z",
    },
    {
      attributes: {
        "@db.instance": "production-acme-postgres",
        "@db.query_signature": "d4e5f6",
        status: "info",
      },
      message: null,
      occurredAtIso: "2026-09-15T12:00:00.000Z",
    },
  ];
}

/** The database product's own declaration, as `censusPageProduct` selects it. */
const DBM_SPEC = {
  identityFacet: "@db.query_signature",
  identityFrom: ["@db.query_signature", "@postgres.query_signature"],
  membersFrom: "@db.metadata.tables",
  product: "dbm" as const,
  serviceFrom: ["@db.instance", "@database_instance", "service"],
  track: "databasequery",
} satisfies PageProductSpec;

describe("foldPageProduct — the shapes a page-counted product yields", () => {
  it("groups by the query signature and counts what the pages actually held", () => {
    const rows = foldPageProduct({ events: dbEvents(), spec: DBM_SPEC });
    expect(rows.map((row) => row.identity)).toEqual(["a1b2c3", "d4e5f6"]);
    expect(rows[0]!.count).toBe(2);
  });

  it("says the count came from the PAGES, because there is no aggregate to ask", () => {
    expect(foldPageProduct({ events: dbEvents(), spec: DBM_SPEC })[0]!.countFrom).toBe("page");
  });

  it("files the row under the database instance the event names", () => {
    expect(foldPageProduct({ events: dbEvents(), spec: DBM_SPEC })[0]!.service).toBe("production-acme-postgres");
  });

  it("keeps the TABLES as members, counted", () => {
    const rows = foldPageProduct({ events: dbEvents(), spec: DBM_SPEC });
    expect(rows[0]!.members).toEqual([
      { count: 2, name: "Customer" },
      { count: 1, name: "Observation" },
    ]);
  });

  it("stores the statement's PATH and never its value, which is the whole disclosure rule", () => {
    const rows = foldPageProduct({ events: dbEvents(), spec: DBM_SPEC });
    expect(rows[0]!.paths.map((path) => path.path)).toContain("@db.statement");
    expect(JSON.stringify(rows[0]!)).not.toContain("someone@example.com");
    expect(JSON.stringify(rows[0]!)).not.toContain("10.1.2.3");
  });

  it("writes a query that reproduces the shape's own events", () => {
    expect(foldPageProduct({ events: dbEvents(), spec: DBM_SPEC })[0]!.query).toBe(
      'service:"production-acme-postgres" @db.query_signature:"a1b2c3"',
    );
  });
});
