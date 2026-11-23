/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import type { HexClient } from "../../../hex/client.js";
import { HexReadErrors } from "../../../hex/errors.js";
import {
  HEX_PAGE_MAX,
  listCells,
  listDataConnections,
  listProjects,
  listQueriedTables,
  listRuns,
  readCellOutput,
  readMe,
  readProject,
} from "../../../hex/reads.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { connectionWire, pageWire, projectWire } from "./wire.js";

/** One request the fake client saw, reduced to what a test asserts on. */
interface Seen {
  readonly path: string;
  readonly query: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A client that answers each call from a queue of bodies and records what it was asked.
 *
 * The queue is the point: a paged read has to be observable across SEVERAL calls, and a single canned body
 * cannot show whether the cursor was carried forward.
 */
function fakeClient({ bodies, seen }: { bodies: unknown[]; seen: Seen[] }): HexClient {
  return {
    get: ({ path, query, boundary }) => {
      seen.push({ path, query });
      const next = bodies.shift();
      if (next === undefined) {
        throw new Error(`the fake client was asked for ${path} with no body left — the case queued too few`);
      }
      return Promise.resolve(ok(unwrap(boundary.parse({ value: next }))));
    },
    getText: ({ path }) => {
      throw new Error(`a typed read asked for ${path} as text — every typed read goes through a boundary`);
    },
  };
}

/** A client that refuses everything with one typed failure. */
function refusingClient(): HexClient {
  return {
    get: ({ path }) => Promise.resolve(err(HexReadErrors.forbidden({ detail: "no", path }))),
    getText: ({ path }) => Promise.resolve(err(HexReadErrors.forbidden({ detail: "no", path }))),
  };
}

const project = projectWire;
const page = pageWire;

describe("the cursor walk", () => {
  it("carries the cursor forward and stops when the page returns none", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({
      bodies: [
        page({ after: "cursor-1", values: [project({ id: "p1" })] }),
        page({ after: null, values: [project({ id: "p2" })] }),
      ],
      seen,
    });
    const listed = await listProjects({ client, limit: 10 });
    expect(unwrap(listed).map((each) => each.id)).toEqual(["p1", "p2"]);
    expect(seen.length).toBe(2);
    expect(seen[0]!.query!["after"]).toBeUndefined();
    expect(seen[1]!.query!["after"]).toBe("cursor-1");
  });

  it("stops at the caller's limit rather than walking to the end", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({
      bodies: [page({ after: "cursor-1", values: [project({ id: "p1" }), project({ id: "p2" })] })],
      seen,
    });
    const listed = await listProjects({ client, limit: 2 });
    expect(unwrap(listed).length).toBe(2);
    expect(seen.length).toBe(1);
  });

  it("asks for no more than the caller still needs", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: null, values: [] })], seen });
    await listProjects({ client, limit: 7 });
    expect(seen[0]!.query!["limit"]).toBe(7);
  });

  it("never asks for a page larger than the document's own maximum", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: null, values: [] })], seen });
    await listProjects({ client, limit: 5000 });
    expect(seen[0]!.query!["limit"]).toBe(HEX_PAGE_MAX);
  });

  it("stops on an EMPTY page even when the cursor says there is more", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: "cursor-1", values: [] })], seen });
    const listed = await listProjects({ client, limit: 10 });
    expect(unwrap(listed)).toEqual([]);
    expect(seen.length).toBe(1);
  });

  it("carries a typed refusal out rather than returning a short list", async () => {
    const listed = await listProjects({ client: refusingClient(), limit: 10 });
    expect(listed.isErr()).toBe(true);
    expect(unwrapErr(listed).code).toBe("FORBIDDEN");
  });
});

describe("each read addresses the documented path", () => {
  it("readMe asks /v1/users/me", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [{ org: { id: "o1" } }], seen });
    await readMe({ client });
    expect(seen[0]!.path).toBe("/v1/users/me");
  });

  it("readProject encodes the id into the path", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [project({ id: "p 1" })], seen });
    await readProject({ client, projectId: "p 1" });
    expect(seen[0]!.path).toBe("/v1/projects/p%201");
  });

  it("listQueriedTables asks the project's own tables path", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: null, values: [] })], seen });
    await listQueriedTables({ client, limit: 10, projectId: "p1" });
    expect(seen[0]!.path).toBe("/v1/projects/p1/queriedTables");
  });

  it("listCells narrows by project through the query, not the path", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: null, values: [] })], seen });
    await listCells({ client, limit: 10, projectId: "p1" });
    expect(seen[0]!.path).toBe("/v1/cells");
    expect(seen[0]!.query!["projectId"]).toBe("p1");
  });

  it("readCellOutput asks the UNSTABLE output path", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({
      bodies: [
        {
          cell: { cellType: "SQL", id: "c1", staticId: "s1" },
          projectId: "p1",
          result: {
            columns: [],
            rowLimit: 100,
            rows: [],
            rowsReturned: 0,
            totalRows: 0,
            totalRowsKind: "EXACT",
            truncated: false,
            type: "table",
          },
          runId: "r1",
        },
      ],
      seen,
    });
    const read = await readCellOutput({ cellId: "c1", client });
    expect(seen[0]!.path).toBe("/v1/cells/c1/output");
    expect(unwrap(read).runId).toBe("r1");
  });

  it("listDataConnections reads the workspace-wide path", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({ bodies: [page({ after: null, values: [] })], seen });
    await listDataConnections({ client, limit: 10 });
    expect(seen[0]!.path).toBe("/v1/data-connections");
  });
});

describe("a read returns the projection, never the validated wire value", () => {
  it("drops a project's unread reviews, sharing, appViews and schedule detail", async () => {
    const client = fakeClient({ bodies: [projectWire({ id: "p1" })], seen: [] });
    const read = unwrap(await readProject({ client, projectId: "p1" }));
    expect(Object.keys(read).toSorted()).toEqual([
      "analytics",
      "archivedAt",
      "categories",
      "createdAt",
      "creator",
      "description",
      "id",
      "lastEditedAt",
      "lastPublishedAt",
      "owner",
      "schedules",
      "status",
      "title",
      "trashedAt",
      "type",
    ]);
    expect(read.analytics).toEqual({ lastViewedAt: null, publishedResultsUpdatedAt: null });
    expect(read.schedules).toEqual([{ enabled: true }]);
  });

  it("keeps a connection's target identifiers and drops its username, port and sharing", async () => {
    const client = fakeClient({
      bodies: [pageWire({ after: null, values: [connectionWire({ id: "c1" })] })],
      seen: [],
    });
    const listed = unwrap(await listDataConnections({ client, limit: 10 }));
    expect(listed).toEqual([
      {
        connectionDetails: {
          bigquery: undefined,
          postgres: { database: "billing", hostname: "db.example.invalid" },
          snowflake: undefined,
        },
        description: "the warehouse",
        id: "c1",
        name: "Billing",
        type: "postgres",
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("reader");
  });

  it("reads a basic-arm connection, which carries no full-arm key at all", async () => {
    const basic = { id: "c1", name: "Billing", sensitivity: { configured: false }, type: "postgres" };
    const client = fakeClient({ bodies: [pageWire({ after: null, values: [basic] })], seen: [] });
    const listed = unwrap(await listDataConnections({ client, limit: 10 }));
    expect(listed.map((connection) => connection.id)).toEqual(["c1"]);
  });

  it("refuses a full-arm connection missing a key its own arm requires, naming the row and the key", async () => {
    const { connectionDetails: _dropped, ...withoutDetails } = connectionWire({ id: "c2" });
    const client = fakeClient({
      bodies: [pageWire({ after: null, values: [connectionWire({ id: "c1" }), withoutDetails] })],
      seen: [],
    });
    const refused = unwrapErr(await listDataConnections({ client, limit: 10 }));
    expect(refused.code).toBe("MALFORMED_RESPONSE");
    expect(refused.message).toBe(
      '/v1/data-connections returned a body this integration cannot read: GET /v1/data-connections answered a shape this version does not read — refused, not guessed: field "values[1].connectionDetails" is missing — a malformed response, NOT an empty result; Hex may have moved this endpoint, which `slopweaver atlas hex sync` reports as spec drift',
    );
  });

  it("holds a row carrying only an OPTIONAL full-arm key to every key that arm requires", async () => {
    const optionalOnly = {
      id: "c1",
      name: "Billing",
      schemaFilters: {},
      sensitivity: { configured: false },
      type: "postgres",
    };
    const client = fakeClient({ bodies: [pageWire({ after: null, values: [optionalOnly] })], seen: [] });
    const refused = unwrapErr(await listDataConnections({ client, limit: 10 }));
    expect(refused.message).toContain(
      'field "values[0].allowWritebackCells" is missing; field "values[0].connectViaSsh" is missing; field "values[0].connectionDetails" is missing',
    );
  });

  it("refuses a half-sent full arm on the first page before it follows the cursor", async () => {
    const seen: Seen[] = [];
    const halfSent = { allowWritebackCells: false, id: "c1", name: "Billing", type: "postgres" };
    const client = fakeClient({
      bodies: [pageWire({ after: "next", values: [halfSent] }), pageWire({ after: null, values: [] })],
      seen,
    });
    const refused = unwrapErr(await listDataConnections({ client, limit: 10 }));
    expect(seen.length).toBe(1);
    expect(refused.message).toContain(
      'field "values[0].connectViaSsh" is missing; field "values[0].connectionDetails" is missing; field "values[0].includeMagic" is missing',
    );
  });

  it("drops a queried-table page's unread traceId", async () => {
    const client = fakeClient({
      bodies: [
        {
          pagination: { after: null, before: null },
          traceId: "t1",
          values: [{ dataConnectionId: "c1", dataConnectionName: "Billing", tableName: "bookings" }],
        },
      ],
      seen: [],
    });
    const listed = unwrap(await listQueriedTables({ client, limit: 10, projectId: "p1" }));
    expect(listed).toEqual([{ dataConnectionId: "c1", dataConnectionName: "Billing", tableName: "bookings" }]);
  });
});

describe("listRuns", () => {
  it("is OFFSET-paged rather than cursor-paged, as the document declares", async () => {
    const seen: Seen[] = [];
    const client = fakeClient({
      bodies: [
        {
          nextPage: "2",
          previousPage: null,
          runs: [
            {
              elapsedTime: 1200,
              endTime: "2026-09-01T00:01:00Z",
              projectId: "p1",
              projectVersion: "3",
              runId: "r1",
              runTrigger: "SCHEDULED",
              runUrl: "https://app.hex.tech/run/r1",
              startTime: "2026-09-01T00:00:00Z",
              status: "COMPLETED",
            },
          ],
          traceId: "t1",
        },
      ],
      seen,
    });
    const listed = await listRuns({ client, limit: 5, projectId: "p1" });
    expect(unwrap(listed)).toEqual([
      {
        elapsedTime: 1200,
        endTime: "2026-09-01T00:01:00Z",
        projectVersion: "3",
        runId: "r1",
        runTrigger: "SCHEDULED",
        runUrl: "https://app.hex.tech/run/r1",
        startTime: "2026-09-01T00:00:00Z",
        status: "COMPLETED",
      },
    ]);
    expect(seen[0]!.query!["offset"]).toBe(0);
    expect(seen[0]!.query!["limit"]).toBe(5);
  });

  it("carries a typed refusal out", async () => {
    const listed = await listRuns({ client: refusingClient(), limit: 5, projectId: "p1" });
    expect(listed.isErr()).toBe(true);
    expect(unwrapErr(listed).code).toBe("FORBIDDEN");
  });
});

describe("readMe and the two token arms", () => {
  const PERSONAL = {
    email: "a@example.invalid",
    id: "u1",
    lastLoginDate: "2026-10-01T00:00:00Z",
    name: "A",
    org: { id: "o1" },
    role: "EDITOR",
    token: { exp: null },
  };

  it("reads a whole personal-token answer", async () => {
    const me = unwrap(await readMe({ client: fakeClient({ bodies: [PERSONAL], seen: [] }) }));
    expect(me.role).toBe("EDITOR");
    expect(me.email).toBe("a@example.invalid");
  });

  it("reads a workspace-token answer, which carries no personal key at all", async () => {
    const me = unwrap(await readMe({ client: fakeClient({ bodies: [{ org: { id: "o1" }, token: null }], seen: [] }) }));
    expect(me).toEqual({
      email: undefined,
      id: undefined,
      name: undefined,
      org: { id: "o1" },
      role: undefined,
      token: null,
    });
  });

  it("reads a workspace-token answer carrying a token object, which the document allows on both arms", async () => {
    const answer = { org: { id: "o1" }, token: { exp: null } };
    const me = unwrap(await readMe({ client: fakeClient({ bodies: [answer], seen: [] }) }));
    expect(me.org).toEqual({ id: "o1" });
    expect(me.role).toBeUndefined();
  });

  it("refuses a personal-token answer missing a key its own arm requires, naming the key", async () => {
    const { role: _dropped, ...withoutRole } = PERSONAL;
    const refused = unwrapErr(await readMe({ client: fakeClient({ bodies: [withoutRole], seen: [] }) }));
    expect(refused.code).toBe("MALFORMED_RESPONSE");
    expect(refused.message).toBe(
      '/v1/users/me returned a body this integration cannot read: GET /v1/users/me answered a shape this version does not read — refused, not guessed: field "role" is missing — a malformed response, NOT an empty result; Hex may have moved this endpoint, which `slopweaver atlas hex sync` reports as spec drift',
    );
  });

  it("names every personal key a half-sent arm is missing", async () => {
    const refused = unwrapErr(
      await readMe({ client: fakeClient({ bodies: [{ email: "a@example.invalid", org: { id: "o1" } }], seen: [] }) }),
    );
    expect(refused.message).toContain(
      'field "id" is missing; field "lastLoginDate" is missing; field "name" is missing; field "role" is missing',
    );
  });
});
