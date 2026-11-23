/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncHexWorkspaceEntities } from "../../../../atlas/hex/entitySync.js";
import { hexProjectDetailSchema, hexResourceDetailSchema } from "../../../../atlas/hex/model.js";
import { readHexSnapshot } from "../../../../atlas/hex/readAdapter.js";
import { hexAtlasPaths } from "../../../../atlas/hex/store.js";
import { readHexSubjects } from "../../../../detective/hexSubjects.js";
import type { HexClient } from "../../../../hex/client.js";
import { HexReadErrors } from "../../../../hex/errors.js";
import { hexConnectionTarget } from "../../../../hex/shape.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-16T03:00:00.000Z";

let home: string | null = null;

/** A throwaway state home, removed after each case. */
function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "hex-entity-"));
  home = root;
  return root;
}

afterEach(() => {
  if (home !== null) {
    rmSync(home, { force: true, recursive: true });
    home = null;
  }
});

/** One page body per path prefix, in the shape each list endpoint returns. */
const BODIES: Readonly<Record<string, unknown>> = {
  "/v1/collections": { pagination: { after: null, before: null }, values: [{ id: "c1", name: "Growth" }] },
  "/v1/data-connections": {
    pagination: { after: null, before: null },
    values: [
      {
        allowWritebackCells: false,
        connectViaSsh: false,
        connectionDetails: { bigquery: { enableStorageApi: true, projectId: "warehouse-prod" } },
        description: "the warehouse",
        id: "dc1",
        includeMagic: true,
        name: "BigQuery prod",
        schemaRefreshAccess: "ADMINS",
        sensitivity: { configured: false },
        sharing: { users: [{ email: "svc-reader@example.com" }] },
        type: "bigquery",
      },
    ],
  },
  "/v1/groups": { pagination: { after: null, before: null }, values: [{ id: "g1", name: "Data" }] },
  "/v1/projects": {
    pagination: { after: null, before: null },
    values: [
      {
        analytics: { lastViewedAt: null, publishedResultsUpdatedAt: null },
        archivedAt: null,
        categories: [{ description: null, name: "Imports" }],
        createdAt: "2026-01-01T00:00:00Z",
        creator: { email: "a@example.com" },
        description: "every cancelled booking",
        id: "p1",
        lastEditedAt: "2026-09-01T00:00:00Z",
        lastPublishedAt: "2026-09-02T00:00:00Z",
        owner: { email: "b@example.com" },
        schedules: [{ enabled: true }],
        status: { name: "Published" },
        title: "Booking health",
        trashedAt: null,
        type: "PROJECT",
      },
    ],
  },
  "/v1/projects/p1/queriedTables": {
    pagination: { after: null, before: null },
    values: [{ dataConnectionId: "dc1", dataConnectionName: "BigQuery prod", tableName: "public.Booking" }],
  },
};

/** A client that answers from `bodies` by path prefix through each read's boundary, and records what it was asked for. */
function fakeClient({
  calls,
  bodies = BODIES,
}: {
  calls: string[];
  bodies?: Readonly<Record<string, unknown>>;
}): HexClient {
  return {
    get: ({ path, boundary }) => {
      calls.push(path);
      // LONGEST prefix, because `/v1/projects/p1/queriedTables` also starts with `/v1/projects` and a
      // first-match lookup would serve the project list to the queried-tables read.
      const key = Object.keys(bodies)
        .filter((candidate) => path.startsWith(candidate))
        .toSorted((left, right) => right.length - left.length)[0];
      const body = key === undefined ? { pagination: { after: null, before: null }, values: [] } : bodies[key];
      const admitted = boundary.parse({ value: body });
      return Promise.resolve(
        admitted.mapErr((boundaryError) => HexReadErrors.malformedResponse({ boundaryError, path })),
      );
    },
    getText: ({ path }) => {
      throw new Error(`the entity fill asked for ${path} as text — every read it makes goes through a boundary`);
    },
  };
}

describe("hexConnectionTarget", () => {
  it("names a BigQuery project", () => {
    expect(
      hexConnectionTarget({
        connection: { connectionDetails: { bigquery: { projectId: "wh" } }, id: "d", name: "n", type: "bigquery" },
      }),
    ).toBe("bigquery:wh");
  });

  it("names a Postgres host and database", () => {
    expect(
      hexConnectionTarget({
        connection: {
          connectionDetails: { postgres: { database: "billing", hostname: "replica.internal" } },
          id: "d",
          name: "n",
          type: "postgres",
        },
      }),
    ).toBe("postgres:replica.internal/billing");
  });

  it("answers null for a basic row Hex described without detail", () => {
    expect(hexConnectionTarget({ connection: { id: "d", name: "n", type: "snowflake" } })).toBeNull();
  });
});

describe("syncHexWorkspaceEntities", () => {
  it("publishes projects and resources into a generation a read can see", async () => {
    const root = tempHome();
    const calls: string[] = [];
    const filled = await syncHexWorkspaceEntities({
      at: AT,
      client: fakeClient({ calls }),
      paths: hexAtlasPaths({ home: root }),
    });
    expect(filled.isOk()).toBe(true);
    expect(unwrap(filled).projectCount).toBe(1);
    expect(unwrap(filled).resourceCount).toBe(3);
    const snapshot = readHexSnapshot({ home: root });
    expect(snapshot.isOk()).toBe(true);
    const projects = unwrap(snapshot).kinds.find((kind) => kind.kind === "project")!;
    expect(projects.entities.length).toBe(1);
    expect(projects.entities[0]!.providerId).toBe("p1");
  });

  it("stores a project's configuration and its queried TABLE NAMES, and nothing that is a row", async () => {
    const root = tempHome();
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls: [] }), paths: hexAtlasPaths({ home: root }) });
    const snapshot = unwrap(readHexSnapshot({ home: root }));
    const entity = snapshot.kinds.find((kind) => kind.kind === "project")!.entities[0]!;
    const detail = hexProjectDetailSchema.parse(entity.detail);
    expect(detail.title).toBe("Booking health");
    expect(detail.ownerEmail).toBe("b@example.com");
    expect(detail.scheduleCount).toBe(1);
    expect(detail.queriedTables).toEqual(["public.Booking"]);
  });

  it("stores a data connection's warehouse target, never a credential field", async () => {
    const root = tempHome();
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls: [] }), paths: hexAtlasPaths({ home: root }) });
    const snapshot = unwrap(readHexSnapshot({ home: root }));
    const resources = snapshot.kinds.find((kind) => kind.kind === "resource")!.entities;
    const connection = resources.find((each) => each.providerId === "data-connection:dc1")!;
    const detail = hexResourceDetailSchema.parse(connection.detail);
    expect(detail.family).toBe("data-connection");
    expect(detail.target).toBe("bigquery:warehouse-prod");
    expect(detail).toEqual({
      connectionType: "bigquery",
      description: "the warehouse",
      family: "data-connection",
      name: "BigQuery prod",
      target: "bigquery:warehouse-prod",
    });
    expect(JSON.stringify(connection)).not.toContain("svc-reader");
  });

  it("marks the workspace surface read under the TOKEN's own role, never the anonymous scope", async () => {
    const root = tempHome();
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls: [] }), paths: hexAtlasPaths({ home: root }) });
    const snapshot = unwrap(readHexSnapshot({ home: root }));
    const cell = snapshot.kinds.find((kind) => kind.kind === "project")!.coverage[0]!;
    expect(cell.state).toBe("synced");
  });

  it("closes the not-configured gap once the kinds are actually filled", async () => {
    const root = tempHome();
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls: [] }), paths: hexAtlasPaths({ home: root }) });
    const snapshot = unwrap(readHexSnapshot({ home: root }));
    const gaps = snapshot.kinds.find((kind) => kind.kind === "project")!.gaps;
    expect(gaps.filter((gap) => gap.condition === "entity-surface-not-configured")).toEqual([]);
  });

  it("reads every family the two kinds are built from", async () => {
    const root = tempHome();
    const calls: string[] = [];
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls }), paths: hexAtlasPaths({ home: root }) });
    expect(calls.some((path) => path.startsWith("/v1/projects/p1/queriedTables"))).toBe(true);
    expect(calls.some((path) => path.startsWith("/v1/data-connections"))).toBe(true);
    expect(calls.some((path) => path.startsWith("/v1/collections"))).toBe(true);
    expect(calls.some((path) => path.startsWith("/v1/groups"))).toBe(true);
  });

  it("stops the fill by name when a queried-tables answer drifts, rather than publishing projects with no tables", async () => {
    const root = tempHome();
    const drifted = {
      pagination: { after: null, before: null },
      values: [{ dataConnectionId: "dc1", dataConnectionName: "Billing", tableName: "bookings", unexpected: 1 }],
    };
    const filled = await syncHexWorkspaceEntities({
      at: AT,
      client: fakeClient({ bodies: { ...BODIES, "/v1/projects/p1/queriedTables": drifted }, calls: [] }),
      paths: hexAtlasPaths({ home: root }),
    });
    expect(unwrapErr(filled)).toMatchObject({
      error: { code: "MALFORMED_RESPONSE", message: expect.stringContaining('new field "values[0].unexpected"') },
      kind: "read",
    });
    expect(unwrap(readHexSnapshot({ home: root })).kinds.flatMap((kind) => kind.entities)).toEqual([]);
  });

  it("feeds the detective gate: a published generation becomes matchable subjects", async () => {
    const root = tempHome();
    await syncHexWorkspaceEntities({ at: AT, client: fakeClient({ calls: [] }), paths: hexAtlasPaths({ home: root }) });
    const read = readHexSubjects({ home: root });
    expect(read.unreadable).toBeNull();
    expect(read.subjects.map((each) => each.name).toSorted()).toEqual(["BigQuery prod", "Booking health"]);
    expect(read.subjects.find((each) => each.family === "project")!.queriedTables).toEqual(["public.Booking"]);
  });
});
