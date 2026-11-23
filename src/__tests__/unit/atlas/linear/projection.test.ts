import { describe, expect, it } from "vitest";

import type { LinearApiSurfaceReading } from "../../../../atlas/linear/apiSurface.js";
import { settingsDeepLink } from "../../../../atlas/linear/deepLinks.js";
import type { LinearAtlasKind, LinearCoverageCell } from "../../../../atlas/linear/model.js";
import { projectLinearAtlas } from "../../../../atlas/linear/projection.js";
import type { LinearBrowserReading } from "../../../../atlas/linear/projectionKit.js";
import type { LinearPageObservation } from "../../../../atlas/linear/walk.js";

const AT = "2026-09-05T00:00:00.000Z";

const EMPTY_COVERAGE: Record<LinearAtlasKind, readonly LinearCoverageCell[]> = {
  operation: [],
  page: [],
  setting: [],
  type: [],
};

const apiReading = (over: Partial<LinearApiSurfaceReading> = {}): LinearApiSurfaceReading => ({
  introspectionBatches: 2,
  operations: [
    {
      detail: {
        deprecationReason: null,
        description: "",
        isDeprecated: false,
        paramNames: [],
        responsePaths: ["nodes", "nodes.key"],
        returnType: "TeamConnection",
        rootKind: "query",
      },
      providerId: "query.teams",
    },
  ],
  schemaFingerprint: "types=1",
  settings: [{ group: "team", pageBoundReached: false, pagesRead: 1, records: [], refusedBecause: null }],
  types: [],
  workspaceId: "w1",
  ...over,
});

const noBrowser = ({ reason }: { reason: string }): LinearBrowserReading => ({
  limited: false,
  observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
  pages: [],
  unavailableBecause: reason,
});

const page = (over: Partial<LinearPageObservation> = {}): LinearPageObservation => ({
  area: "workspace",
  artifacts: [
    { byteLength: 3, kind: "page-png", mediaType: "image/png", relativePath: "a.png", sha256: "a".repeat(64) },
  ],
  captureComplete: true,
  finalUrl: "https://linear.app/acme/settings/members",
  graphqlCallCount: 1,
  observedAt: AT,
  outcome: "reached",
  pageScope: "workspace",
  providerId: "/settings/members",
  requestedUrl: "https://linear.app/acme/settings/members",
  statusCode: 200,
  title: "Members",
  ...over,
});

describe("projectLinearAtlas — coverage honesty", () => {
  it("raises a gap and an unavailable cell for a configuration read the provider refused", () => {
    const projection = projectLinearAtlas({
      api: apiReading({
        settings: [
          { group: "webhook", pageBoundReached: false, pagesRead: 1, records: [], refusedBecause: "admin required" },
        ],
      }),
      at: AT,
      browser: noBrowser({ reason: "not attempted" }),
      plannedCount: 0,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const cell = projection.coverage.setting.find((candidate) => candidate.scope === "webhook")!;
    expect(cell.state).toBe("unavailable");
    expect(cell.reason).toContain("admin required");
    expect(projection.gaps.setting.filter((gap) => gap.condition === "settings-surface-refused").length).toBe(1);
  });

  it("grades the browser surface DEFERRED when it reached fewer pages than were planned", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: { graphqlResponses: 1, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 3,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.coverage.page.find((cell) => cell.channel === "browser")!.state).toBe("deferred");
  });

  it("grades the browser surface SYNCED only when every planned page was reached", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: { graphqlResponses: 1, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.coverage.page.find((cell) => cell.channel === "browser")!.state).toBe("synced");
  });

  it("keeps an unphotographed page out of the reached count, so it cannot earn SYNCED", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [page({ artifacts: [], outcome: "unphotographed" })],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.coverage.page.find((cell) => cell.channel === "browser")!.state).toBe("deferred");
    expect(projection.gaps.page.filter((gap) => gap.condition === "settings-page-unphotographed").length).toBe(1);
  });

  it("always carries the declared-denominator gap, because the route table is not a platform census", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: noBrowser({ reason: "not attempted" }),
      plannedCount: 0,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.page.filter((gap) => gap.condition === "page-inventory-is-declared").length).toBe(1);
  });
});

describe("projectLinearAtlas — disagreement", () => {
  it("reports a root field the client selected that the schema does not declare", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            { detail: { callCount: 1, responsePaths: ["id"], responsePathsTotal: 1 }, providerId: "query.passkeys" },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const gap = projection.gaps.operation.find((candidate) => candidate.scope === "query.passkeys")!;
    expect(gap.condition).toBe("api-browser-disagreement");
    expect(gap.surfaces).toEqual(["api", "browser"]);
  });

  it("reports a response path the client got back that the schema does not declare", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["nodes", "nodes.secretExtra"], responsePathsTotal: 2 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.find((gap) => gap.scope === "query.teams")!.fields).toEqual(["nodes.secretExtra"]);
  });

  it("does NOT report a schema operation the browser simply never called", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.filter((gap) => gap.condition === "api-browser-disagreement")).toEqual([]);
  });

  it("joins an operation both channels saw into ONE entity carrying both", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 2, responsePaths: ["nodes"], responsePathsTotal: 1 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const teams = projection.entities.operation.filter((entity) => entity.providerId === "query.teams");
    expect(teams.length).toBe(1);
    expect(teams[0]!.channels.api === null).toBe(false);
    expect(teams[0]!.channels.browser === null).toBe(false);
  });
});

describe("projectLinearAtlas — rechecks", () => {
  it("marks the browser surface resolved once a walk actually ran, so its gap can close", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: { graphqlResponses: 1, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const recheck = projection.rechecks.find(
      (candidate) => candidate.condition === "browser-surface-unreadable" && candidate.scope === "settings-walk",
    )!;
    expect(recheck.resolved).toBe(true);
  });

  it("rechecks nothing about the browser when the browser did not run", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: noBrowser({ reason: "relay unavailable" }),
      plannedCount: 0,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.rechecks.filter((recheck) => recheck.condition === "browser-surface-unreadable")).toEqual([]);
  });

  it("refuses to call a condition resolved when this run raised a gap for it", () => {
    const projection = projectLinearAtlas({
      api: apiReading({
        settings: [
          { group: "webhook", pageBoundReached: false, pagesRead: 1, records: [], refusedBecause: "admin required" },
        ],
      }),
      at: AT,
      browser: noBrowser({ reason: "not attempted" }),
      plannedCount: 0,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const recheck = projection.rechecks.find(
      (candidate) => candidate.condition === "settings-surface-refused" && candidate.scope === "webhook",
    )!;
    expect(recheck.resolved).toBe(false);
  });

  it("marks a configuration surface resolved once it reads cleanly", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: noBrowser({ reason: "not attempted" }),
      plannedCount: 0,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    const recheck = projection.rechecks.find(
      (candidate) => candidate.condition === "settings-surface-refused" && candidate.scope === "team",
    )!;
    expect(recheck.resolved).toBe(true);
  });
});

describe("settingsDeepLink", () => {
  it("points a team-scoped record at that team's own settings page", () => {
    expect(settingsDeepLink({ group: "workflow-state", scope: "ENG", urlBase: "https://linear.app/acme" })).toBe(
      "https://linear.app/acme/settings/teams/ENG/workflow",
    );
  });

  it("points a workspace-scoped record at the workspace page", () => {
    expect(settingsDeepLink({ group: "issue-label", scope: "workspace", urlBase: "https://linear.app/acme" })).toBe(
      "https://linear.app/acme/settings/labels",
    );
  });

  it("has no link when the workspace is not known", () => {
    expect(settingsDeepLink({ group: "issue-label", scope: "workspace", urlBase: null })).toBe(null);
  });

  it("has no link for a group no declared route renders", () => {
    expect(settingsDeepLink({ group: "rate-limit", scope: "workspace", urlBase: "https://linear.app/acme" })).toBe(
      null,
    );
  });
});

describe("projectLinearAtlas — a list field is not a disagreement", () => {
  it("does NOT report a schema path as undeclared merely because the response held a list of it", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["nodes", "nodes[].key"], responsePathsTotal: 2 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.filter((gap) => gap.condition === "api-browser-disagreement")).toEqual([]);
  });

  it("still reports a path the schema genuinely does not declare, list marker or not", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["nodes[].undeclaredThing"], responsePathsTotal: 1 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.find((gap) => gap.scope === "query.teams")!.fields).toEqual([
      "nodes[].undeclaredThing",
    ]);
  });
});

describe("projectLinearAtlas — a LEADING list marker is not a disagreement", () => {
  it("matches a root-level list field against the schema's own unmarked path", () => {
    const projection = projectLinearAtlas({
      api: apiReading({
        operations: [
          {
            detail: {
              deprecationReason: null,
              description: "",
              isDeprecated: false,
              paramNames: [],
              responsePaths: ["browserType", "id"],
              returnType: "SessionResponse",
              rootKind: "query",
            },
            providerId: "query.sessions",
          },
        ],
      }),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["[].browserType", "[].id"], responsePathsTotal: 2 },
              providerId: "query.sessions",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.filter((gap) => gap.condition === "api-browser-disagreement")).toEqual([]);
  });
});

describe("projectLinearAtlas — a path deeper than the schema window is not a disagreement", () => {
  it("does not report a three-level path the schema was never asked about", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["nodes[].team.key"], responsePathsTotal: 1 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.filter((gap) => gap.condition === "api-browser-disagreement")).toEqual([]);
  });

  it("still reports an undeclared path INSIDE the comparable window", () => {
    const projection = projectLinearAtlas({
      api: apiReading(),
      at: AT,
      browser: {
        limited: false,
        observations: {
          graphqlResponses: 1,
          observations: [
            {
              detail: { callCount: 1, responsePaths: ["nodes[].mystery"], responsePathsTotal: 1 },
              providerId: "query.teams",
            },
          ],
          unexplainedKeys: [],
          unresolvedRequests: 0,
        },
        pages: [page()],
        unavailableBecause: null,
      },
      plannedCount: 1,
      previousCoverage: EMPTY_COVERAGE,
      workspaceUrlBase: null,
    });
    expect(projection.gaps.operation.find((gap) => gap.scope === "query.teams")!.fields).toEqual(["nodes[].mystery"]);
  });
});
