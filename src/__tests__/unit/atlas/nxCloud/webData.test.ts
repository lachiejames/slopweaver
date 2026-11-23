import { describe, expect, it } from "vitest";

import {
  buildNxCloudWebData,
  endpointEntities,
  type NxCloudCallOutcome,
  scopeEntities,
} from "../../../../atlas/nxCloud/webData.js";
import { webDataGaps, webDataRechecks } from "../../../../atlas/nxCloud/webDataGaps.js";

const AT = "2026-09-05T00:00:00.000Z";
const SCOPE = { orgId: "aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb" };

/** The overview payload, keyed by client route id exactly as a single-fetch response is. */
const OVERVIEW_PAYLOAD = {
  "routes/_auth.orgs.$orgId": {
    data: {
      contributorsCount: 38,
      currentUsagePercentage: 100,
      isAdmin: false,
      organization: { enabled: true, memberships: [], name: "Example Org", plan: "TEAM" },
    },
  },
  "routes/_auth.orgs.$orgId.workspaces.$workspaceId": {
    data: { workspace: { name: "example-monorepo", orgId: SCOPE.orgId } },
  },
};

/** One call outcome, with everything a healthy read has. */
function outcome({ callId, over = {} }: { callId: string; over?: Partial<NxCloudCallOutcome> }): NxCloudCallOutcome {
  return {
    callId,
    decoded: null,
    failure: null,
    response: { body: "", contentType: "text/x-script", statusCode: 200, url: `https://cloud.nx.app/${callId}` },
    url: `https://cloud.nx.app/${callId}`,
    ...over,
  };
}

const OVERVIEW_OK = outcome({ callId: "workspace-overview", over: { decoded: OVERVIEW_PAYLOAD } });
const ROSTER_EMPTY = outcome({
  callId: "organizations",
  over: { decoded: { "routes/_auth.orgs._index": { data: { organizations: [] } } } },
});

describe("scopeEntities", () => {
  it("projects one organisation and one workspace out of the overview call", () => {
    const entities = scopeEntities({ at: AT, outcome: OVERVIEW_OK, scope: SCOPE });
    expect(entities.map((entity) => entity.kind)).toEqual(["organization", "workspace"]);
  });

  it("keys the organisation by the id the caller asked for, never by one the payload states", () => {
    const entities = scopeEntities({ at: AT, outcome: OVERVIEW_OK, scope: SCOPE });
    expect(entities[0]!.providerId).toBe(SCOPE.orgId);
  });

  it("carries a deep link a human can open to see the workspace", () => {
    const entities = scopeEntities({ at: AT, outcome: OVERVIEW_OK, scope: SCOPE });
    expect(entities[1]!.channels["web-data"]!.source!.deepLink).toBe(
      `https://cloud.nx.app/orgs/${SCOPE.orgId}/workspaces/${SCOPE.workspaceId}/overview`,
    );
  });

  it("produces nothing at all from a payload with neither block, which is what a 403 decodes to", () => {
    expect(scopeEntities({ at: AT, outcome: outcome({ callId: "workspace-overview" }), scope: SCOPE })).toEqual([]);
  });
});

describe("endpointEntities", () => {
  it("keys an operation in the same placeholder vocabulary the browser channel uses, so the two can match", () => {
    const entities = endpointEntities({ at: AT, outcomes: [OVERVIEW_OK] });
    expect(entities[0]!.providerId).toBe("GET /orgs/<id>/workspaces/<id>/overview.data");
  });

  it("records the query parameter names the inventory sends", () => {
    const entities = endpointEntities({ at: AT, outcomes: [outcome({ callId: "workspace-insights" })] });
    const detail = entities[0]!.channels["web-data"]!.detail as { queryParams: readonly string[] };
    expect(detail.queryParams).toEqual(["dayCount"]);
  });

  it("records the loader route ids a single-fetch payload named", () => {
    const entities = endpointEntities({ at: AT, outcomes: [OVERVIEW_OK] });
    const detail = entities[0]!.channels["web-data"]!.detail as { loaderRouteIds: readonly string[] };
    expect(detail.loaderRouteIds).toEqual([
      "routes/_auth.orgs.$orgId",
      "routes/_auth.orgs.$orgId.workspaces.$workspaceId",
    ]);
  });

  it("produces no row for a call that never got a response", () => {
    expect(
      endpointEntities({ at: AT, outcomes: [outcome({ callId: "organizations", over: { response: null } })] }),
    ).toEqual([]);
  });
});

describe("webDataGaps", () => {
  it("records a 403 as a refusal rather than a failure", () => {
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    const gaps = webDataGaps({ at: AT, outcomes: [refused], scope: SCOPE });
    expect(gaps[0]!.condition).toBe("call-refused");
  });

  it("records a 500 as a failure a later run could clear", () => {
    const failed = outcome({
      callId: "workspace-runs",
      over: { response: { body: "", contentType: "", statusCode: 500, url: "u" } },
    });
    expect(webDataGaps({ at: AT, outcomes: [failed], scope: SCOPE })[0]!.condition).toBe("call-failed");
  });

  it("raises the roster finding when a reachable workspace's organisation is not on the list", () => {
    const gaps = webDataGaps({ at: AT, outcomes: [OVERVIEW_OK, ROSTER_EMPTY], scope: SCOPE });
    expect(gaps.map((gap) => gap.condition)).toEqual(["roster-omits-reachable-workspace"]);
  });

  it("raises no roster finding when the list does name the organisation", () => {
    const listed = outcome({
      callId: "organizations",
      over: {
        decoded: { "routes/_auth.orgs._index": { data: { organizations: [{ id: SCOPE.orgId, name: "Example" }] } } },
      },
    });
    expect(webDataGaps({ at: AT, outcomes: [OVERVIEW_OK, listed], scope: SCOPE })).toEqual([]);
  });

  it("raises no roster finding when the workspace itself could not be reached", () => {
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    const gaps = webDataGaps({ at: AT, outcomes: [refused, ROSTER_EMPTY], scope: SCOPE });
    expect(gaps.map((gap) => gap.condition)).toEqual(["call-refused"]);
  });

  it("scopes a call gap to the workspace and the call, so two calls do not share one gap", () => {
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    expect(webDataGaps({ at: AT, outcomes: [refused], scope: SCOPE })[0]!.scope).toBe(
      `${SCOPE.workspaceId}:workspace-overview`,
    );
  });
});

describe("webDataRechecks", () => {
  it("marks a call that succeeded as resolving its refusal gap", () => {
    const rechecks = webDataRechecks({ outcomes: [OVERVIEW_OK], scope: SCOPE });
    expect(rechecks.find((recheck) => recheck.condition === "call-refused")!.resolved).toBe(true);
  });

  it("marks a call that was refused as not resolving it", () => {
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    const rechecks = webDataRechecks({ outcomes: [refused], scope: SCOPE });
    expect(rechecks.find((recheck) => recheck.condition === "call-refused")!.resolved).toBe(false);
  });

  it("rechecks the roster finding only when the roster call itself answered", () => {
    const rechecks = webDataRechecks({ outcomes: [OVERVIEW_OK], scope: SCOPE });
    expect(rechecks.some((recheck) => recheck.condition === "roster-omits-reachable-workspace")).toBe(false);
  });
});

describe("buildNxCloudWebData", () => {
  it("declares one family entity per declared family, even when nothing measured them", () => {
    const built = buildNxCloudWebData({ at: AT, outcomes: [OVERVIEW_OK], previousCoverage: {}, scope: SCOPE });
    expect(built.entities.family.map((entity) => entity.providerId)).toEqual(["ci-pipeline-execution", "run", "task"]);
  });

  it("grades the workspace kind synced when the overview answered", () => {
    const built = buildNxCloudWebData({ at: AT, outcomes: [OVERVIEW_OK], previousCoverage: {}, scope: SCOPE });
    expect(built.coverage.workspace[0]!.state).toBe("synced");
  });

  it("grades the workspace kind unreadable when the overview was refused", () => {
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    const built = buildNxCloudWebData({ at: AT, outcomes: [refused], previousCoverage: {}, scope: SCOPE });
    expect(built.coverage.workspace[0]!.state).toBe("unreadable");
  });

  it("carries a prior success forward through a failed attempt, so a failure stops being current without erasing", () => {
    const previous = {
      workspace: {
        artifacts: [],
        lastSuccessAt: "2026-09-01T00:00:00.000Z",
        latestAttemptFailed: false,
        reason: "an earlier run",
        role: "authoritative" as const,
        scope: SCOPE.workspaceId,
        state: "synced" as const,
        surface: "web-data",
        unblockedBy: null,
        visibilityScope: "session-member-role",
      },
    };
    const refused = outcome({
      callId: "workspace-overview",
      over: { response: { body: "", contentType: "", statusCode: 403, url: "u" } },
    });
    const built = buildNxCloudWebData({ at: AT, outcomes: [refused], previousCoverage: previous, scope: SCOPE });
    expect(built.coverage.workspace[0]!.lastSuccessAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("writes no route coverage at all, because the browser channel owns that kind", () => {
    const built = buildNxCloudWebData({ at: AT, outcomes: [OVERVIEW_OK], previousCoverage: {}, scope: SCOPE });
    expect(built.coverage.route).toEqual([]);
  });

  it("stamps every cell with the one visibility ceiling both channels read under", () => {
    const built = buildNxCloudWebData({ at: AT, outcomes: [OVERVIEW_OK], previousCoverage: {}, scope: SCOPE });
    expect(built.coverage.organization[0]!.visibilityScope).toBe("session-member-role");
  });

  it("reports every call that failed, so a caller can refuse to publish a half-generation", () => {
    const broken = outcome({
      callId: "workspace-runs",
      over: {
        failure: { call: "workspace-runs", code: "PAYLOAD_UNREADABLE", message: "bad shape" },
        response: null,
      },
    });
    const built = buildNxCloudWebData({ at: AT, outcomes: [OVERVIEW_OK, broken], previousCoverage: {}, scope: SCOPE });
    expect(built.failures.map((failure) => failure.code)).toEqual(["PAYLOAD_UNREADABLE"]);
  });
});
