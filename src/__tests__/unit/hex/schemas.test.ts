import { describe, expect, it } from "vitest";

import {
  hexCellOutputBoundary,
  hexCellsBoundary,
  hexCollectionsBoundary,
  hexDataConnectionsBoundary,
  hexGroupsBoundary,
  hexMeBoundary,
  hexProjectBoundary,
  hexProjectRunsBoundary,
  hexProjectsBoundary,
  hexQueriedTablesBoundary,
} from "../../../hex/schemas.js";
import type { BoundaryDrift } from "../../../lib/boundary.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { connectionWire, pageWire, projectWire } from "./wire.js";

/** The drift list a refused project page carries, THROWING when the refusal is not a shape change. */
function driftOf({ value }: { value: unknown }): readonly BoundaryDrift[] {
  const refused = unwrapErr(hexProjectsBoundary.parse({ value }));
  if (refused.code !== "BOUNDARY_SHAPE_CHANGED") {
    throw new Error(`expected BOUNDARY_SHAPE_CHANGED, got ${refused.code}`);
  }
  return refused.drift;
}

describe("each endpoint's boundary admits the documented answer", () => {
  it("/v1/users/me — a personal token, every user field present", () => {
    const me = unwrap(
      hexMeBoundary.parse({
        value: {
          email: "a@example.invalid",
          id: "u1",
          lastLoginDate: "2026-10-01T00:00:00Z",
          name: "A",
          org: { id: "o1" },
          role: "ADMIN",
          token: { exp: null },
        },
      }),
    );
    expect(me.role).toBe("ADMIN");
  });

  it("/v1/users/me — a workspace token, which carries the org alone", () => {
    expect(unwrap(hexMeBoundary.parse({ value: { org: { id: "o1" }, token: null } })).org.id).toBe("o1");
  });

  it("/v1/projects and /v1/projects/{id} share the row and keep separate boundaries", () => {
    expect(
      unwrap(hexProjectsBoundary.parse({ value: pageWire({ after: null, values: [projectWire({ id: "p1" })] }) }))
        .values.length,
    ).toBe(1);
    expect(unwrap(hexProjectBoundary.parse({ value: projectWire({ id: "p1" }) })).id).toBe("p1");
    expect(hexProjectBoundary.endpoint).toBe("GET /v1/projects/{projectId}");
  });

  it("/v1/projects/{id}/queriedTables", () => {
    const value = {
      pagination: { after: null, before: null },
      traceId: "t1",
      values: [{ dataConnectionId: "c1", dataConnectionName: "Billing", tableName: "bookings" }],
    };
    expect(unwrap(hexQueriedTablesBoundary.parse({ value })).values[0]!.tableName).toBe("bookings");
  });

  it("/v1/data-connections — the basic arm and the full arm in one page", () => {
    const basic = { id: "c0", name: "Scratch", type: "bigquery" };
    const value = pageWire({ after: null, values: [basic, connectionWire({ id: "c1" })] });
    expect(unwrap(hexDataConnectionsBoundary.parse({ value })).values.map((row) => row.id)).toEqual(["c0", "c1"]);
  });

  it("/v1/collections and /v1/groups", () => {
    const collections = pageWire({
      after: null,
      values: [{ creator: { email: "a" }, id: "k1", name: "Ops", sharing: {} }],
    });
    const groups = pageWire({ after: null, values: [{ createdAt: "2026-01-01T00:00:00Z", id: "g1", name: "Eng" }] });
    expect(unwrap(hexCollectionsBoundary.parse({ value: collections })).values[0]!.name).toBe("Ops");
    expect(unwrap(hexGroupsBoundary.parse({ value: groups })).values[0]!.name).toBe("Eng");
  });

  it("/v1/cells — a SQL cell's source", () => {
    const cell = {
      cellType: "SQL",
      contents: { codeCell: null, markdownCell: null, sqlCell: { outputDataframe: "df", source: "select 1" } },
      dataConnectionId: "c1",
      id: "cell1",
      label: null,
      projectId: "p1",
      staticId: "s1",
    };
    const value = pageWire({ after: null, values: [cell] });
    expect(unwrap(hexCellsBoundary.parse({ value })).values[0]!.contents.sqlCell!.source).toBe("select 1");
  });

  it("/v1/cells/{id}/output — the table arm and the error arm", () => {
    const cell = { cellType: "SQL", id: "cell1", staticId: "s1" };
    const table = {
      cell,
      projectId: "p1",
      result: {
        columns: [{ name: "n", type: "NUMBER" }],
        rowLimit: 100,
        rows: [{ n: "1" }, { n: null }],
        rowsReturned: 2,
        totalRows: null,
        totalRowsKind: "UNKNOWN",
        truncated: false,
        type: "table",
      },
      runId: "r1",
    };
    const failed = {
      cell,
      projectId: "p1",
      result: { message: "boom", traceback: null, type: "cell_run_error" },
      runId: "r2",
    };
    expect(unwrap(hexCellOutputBoundary.parse({ value: table })).result.type).toBe("table");
    expect(unwrap(hexCellOutputBoundary.parse({ value: failed })).result.type).toBe("cell_run_error");
  });

  it('/v1/projects/{id}/runs — projectVersion is the document\'s string, numbered from "1" or "draft"', () => {
    const value = {
      nextPage: null,
      previousPage: null,
      runs: [
        {
          elapsedTime: null,
          endTime: null,
          projectId: "p1",
          projectVersion: "draft",
          runId: "r1",
          runTrigger: "API",
          runUrl: "https://app.hex.tech/run/r1",
          startTime: null,
          status: "RUNNING",
          traceId: "t1",
        },
      ],
      traceId: "t1",
    };
    expect(unwrap(hexProjectRunsBoundary.parse({ value })).runs[0]!.projectVersion).toBe("draft");
  });
});

describe("a moved key is refused BY NAME", () => {
  it("a new field on a project row", () => {
    const row = { ...projectWire({ id: "p1" }), unexpected: 1 };
    expect(driftOf({ value: pageWire({ after: null, values: [row] }) })).toEqual([
      { detail: 'new field "values[0].unexpected"', kind: "new", path: "values[0].unexpected" },
    ]);
  });

  it("a missing field on a project row", () => {
    const { title: _dropped, ...row } = projectWire({ id: "p1" });
    expect(driftOf({ value: pageWire({ after: null, values: [row] }) })).toEqual([
      { detail: 'field "values[0].title" is missing', kind: "missing", path: "values[0].title" },
    ]);
  });

  it("a renamed field on a project row", () => {
    const { title, ...rest } = projectWire({ id: "p1" });
    const row = { ...rest, titel: title };
    expect(driftOf({ value: pageWire({ after: null, values: [row] }) })).toEqual([
      { detail: 'field "values[0].title" renamed to "values[0].titel"?', kind: "renamed", path: "values[0].titel" },
    ]);
  });

  it("a new field nested below the row, inside a category", () => {
    const row = { ...projectWire({ id: "p1" }), categories: [{ colour: "red", description: null, name: "Ops" }] };
    expect(driftOf({ value: pageWire({ after: null, values: [row] }) })).toEqual([
      { detail: 'new field "values[0].categories[0].colour"', kind: "new", path: "values[0].categories[0].colour" },
    ]);
  });

  it("a key added to a connection's details, where a credential would arrive", () => {
    const row = connectionWire({ id: "c1" });
    const value = pageWire({
      after: null,
      values: [{ ...row, connectionDetails: { postgres: { hostname: "h", password: "x" } } }],
    });
    const refused = unwrapErr(hexDataConnectionsBoundary.parse({ value }));
    expect(refused.message).toContain('new field "values[0].connectionDetails.postgres.password"');
  });
});
