import { describe, expect, it } from "vitest";
import { z } from "zod";

import { responseFieldPaths } from "../../../../atlas/kit/responseShape.js";
import { unreadTrelicaKeys } from "../../../../atlas/trelica/boundaryShapes.js";
import { TRELICA_PATH_DEPTH, TRELICA_SEGMENTS } from "../../../../atlas/trelica/browserReduction.js";
import { trelicaIntegrationsBoundary } from "../../../../atlas/trelica/estateBoundaries.js";
import { trelicaTeamsBoundary } from "../../../../atlas/trelica/peopleBoundaries.js";
import { defineTrelicaBoundary } from "../../../../atlas/trelica/trelicaBoundary.js";
import { unwrap } from "../../../../lib/result.js";

/** The field paths the method map's census would record for one value. */
function pathsOf({ body }: { body: unknown }): string[] {
  return [...responseFieldPaths({ body, classify: TRELICA_SEGMENTS, depthCap: TRELICA_PATH_DEPTH })].toSorted();
}

/** One connection, as the live tenant answers it, with its secret-bearing configuration filled in. */
const CONNECTION = {
  app: { name: "Google Workspace" },
  authorisedUserInfo: { email: "admin@example.com" },
  enabled: true,
  id: "conn-1",
  issueCount: 0,
  lastResult: {
    failedAppCount: 0,
    failedAssetCount: 0,
    failedUserCount: 0,
    newUserCount: 0,
    sourceAppCount: 1,
    sourceAssetCount: 0,
    sourceUserCount: 3,
  },
  lastSyncDate: "2026-10-15T00:00:00Z",
  needsReconnect: false,
  parameters: { apiToken: "tok-canary", clientSecret: "secret-canary", scimToken: "scim-canary" },
  status: "Connected",
};

/** One integration catalogue page holding that connection. */
const PAGE = {
  items: [
    {
      applicationName: "Google Workspace",
      clients: [{ clientId: "client-canary", scopes: ["admin"] }],
      integrations: [CONNECTION],
      supportsDeprovision: true,
      supportsProvisioning: true,
      supportsRevoke: false,
    },
  ],
  resultsTruncated: false,
  total: 1,
};

describe("defineTrelicaBoundary's census view", () => {
  it("keeps a declared-unread key's name and drops every name beneath it, which the raw answer carries", () => {
    const admitted = unwrap(trelicaIntegrationsBoundary.parse({ value: PAGE }));
    // The sync walks one record at a time, so both halves walk the page's one record.
    const raw = pathsOf({ body: admitted.items[0] });
    const view = z
      .object({ items: z.array(z.unknown()) })
      .parse(trelicaIntegrationsBoundary.censusView({ value: admitted }));
    const census = pathsOf({ body: view.items[0] });

    expect(raw).toContain("integrations[].parameters.clientSecret");
    expect(raw).toContain("clients[].scopes");
    expect(census.filter((path) => path.includes("parameters."))).toEqual([]);
    expect(census.filter((path) => path.startsWith("clients"))).toEqual(["clients"]);
    expect(census.filter((path) => path.startsWith("integrations[].parameters"))).toEqual([
      "integrations[].parameters",
    ]);
    expect(census).toContain("applicationName");
    expect(census).toContain("integrations[].lastResult");
  });

  it("walks a map keyed by id against its value schema, so a team's read fields survive", () => {
    const tree = {
      noTeamPersonCount: 2,
      rootTeamIds: ["t1"],
      teamsById: { t1: { childIds: [], externalIds: { scim: "ext-canary" }, id: "t1", name: "Eng", personCount: 4 } },
      totalPersonCount: 6,
    };
    const view = trelicaTeamsBoundary.censusView({ value: unwrap(trelicaTeamsBoundary.parse({ value: tree })) });

    expect(view).toEqual({
      noTeamPersonCount: 2,
      rootTeamIds: ["t1"],
      teamsById: { t1: { childIds: [], externalIds: null, id: "t1", name: "Eng", personCount: 4 } },
      totalPersonCount: 6,
    });
  });

  it("answers null for a composite whose schema shape the walk does not know, so a new type fails closed", () => {
    const boundary = defineTrelicaBoundary({
      callId: null,
      endpoint: "GET /probe",
      schema: z.strictObject({ id: z.string(), pair: z.tuple([z.string(), z.strictObject({ secret: z.string() })]) }),
    });
    const value = unwrap(boundary.parse({ value: { id: "a", pair: ["b", { secret: "tuple-canary" }] } }));

    expect(value.pair[1].secret).toBe("tuple-canary");
    expect(boundary.censusView({ value })).toEqual({ id: "a", pair: null });
  });

  it("keeps a declared-unread object as null while a read sibling keeps its value", () => {
    const boundary = defineTrelicaBoundary({
      callId: null,
      endpoint: "GET /probe",
      schema: z.strictObject({ name: z.string(), ...unreadTrelicaKeys({ keys: ["variables"] }) }),
    });
    const value = unwrap(boundary.parse({ value: { name: "run", variables: { x_password: "pw-canary" } } }));

    expect(boundary.censusView({ value })).toEqual({ name: "run", variables: null });
  });
});

describe("the integrations boundary", () => {
  it("admits a connection whose last sync reports an AI usage record count, which it declares unread", () => {
    const withCount = { ...CONNECTION, lastResult: { ...CONNECTION.lastResult, aiUsageRecordCount: 4 } };
    const page = { ...PAGE, items: [{ ...PAGE.items[0]!, integrations: [withCount] }] };
    const admitted = unwrap(trelicaIntegrationsBoundary.parse({ value: page }));
    const view = z
      .object({ items: z.array(z.unknown()) })
      .parse(trelicaIntegrationsBoundary.censusView({ value: admitted }));

    expect(pathsOf({ body: view.items[0] })).toContain("integrations[].lastResult.aiUsageRecordCount");
    expect(admitted.items[0]!.integrations![0]!.lastResult.sourceUserCount).toBe(3);
  });
});
