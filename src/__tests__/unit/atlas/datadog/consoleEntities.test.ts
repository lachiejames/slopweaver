/**
 * The Datadog console walk's projection into entity rows: a `console-page` per walked route, a
 * `console-request` per observed call, and the `console` channel folded onto the registry operations those
 * calls corroborated.
 */
import { describe, expect, it } from "vitest";

import { corroborations, pageEntity, requestEntity } from "../../../../atlas/datadog/consoleEntities.js";
import type { ConsoleRequestObservation } from "../../../../atlas/datadog/consoleReduction.js";
import type { ConsolePageObservation, DatadogWalkResult } from "../../../../atlas/datadog/consoleWalk.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { datadogEntityId } from "../../../../atlas/datadog/identity.js";
import type { DatadogSurfaceRow } from "../../../../atlas/datadog/surfaceRow.js";
import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";

const AT = "2026-10-13T09:00:00.000Z";
const ORIGIN = "https://app.datadoghq.com";

const ARTIFACT: AtlasArtifactRef = {
  byteLength: 1234,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/console/monitors.png",
  sha256: "a".repeat(64),
};

/** One real registry row, looked up by its surface name. */
function surface({ name }: { name: string }): DatadogSurfaceRow {
  return DATADOG_SURFACES.find((row) => row.name === name)!;
}

/** A walked page at `/monitors/manage`, with the given outcome and accounting. */
function page({
  outcome,
  responseAccounting,
}: {
  outcome: ConsolePageObservation["outcome"];
  responseAccounting: ConsolePageObservation["responseAccounting"];
}): ConsolePageObservation {
  return {
    artifacts: [ARTIFACT],
    finalUrl: `${ORIGIN}/monitors/manage`,
    outcome,
    responseAccounting,
    route: { href: "/monitors/manage", label: "Monitors", posture: "read", section: "monitors" },
    statusCode: 200,
    title: "Manage Monitors",
  };
}

/** One observed call, corroborating `registry` (or nothing). */
function request({
  method,
  pathShape,
  registry,
}: {
  method: string;
  pathShape: string;
  registry: DatadogSurfaceRow | null;
}): ConsoleRequestObservation {
  return {
    method,
    observedOnPages: ["/dashboard/lists", "/monitors/manage"],
    paramNames: ["page", "page_size"],
    pathShape,
    registry,
    responseFieldPaths: ["data[].id", "data[].name"],
    statusCodes: [200, 304],
  };
}

/** A walk result carrying only `requests`. */
function walkOf({ requests }: { requests: readonly ConsoleRequestObservation[] }): DatadogWalkResult {
  return {
    artifactsWritten: 0,
    finalUrls: [],
    incompletePages: [],
    nav: null,
    navError: null,
    notAttempted: [],
    omitted: [],
    pages: [],
    palette: null,
    paletteError: null,
    requests,
    unrenderedPages: [],
  };
}

describe("pageEntity", () => {
  it("projects a landed page with its measured accounting and a browser-discovered deep link", () => {
    const accounting = { bodyFailed: 1, bodySucceeded: 11, eligible: 12, seen: 40 };
    expect(
      pageEntity({ at: AT, origin: ORIGIN, page: page({ outcome: "landed", responseAccounting: accounting }) }),
    ).toEqual({
      channels: {
        api: null,
        "compiled-catalogue": null,
        console: {
          channel: "console",
          detail: {
            finalUrl: `${ORIGIN}/monitors/manage`,
            href: "/monitors/manage",
            label: "Monitors",
            outcome: "landed",
            posture: "read",
            responseAccounting: { bodyFailed: 1, bodySucceeded: 11, eligible: 12, seen: 40 },
            section: "monitors",
            statusCode: 200,
            title: "Manage Monitors",
          },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: {
            artifacts: [ARTIFACT],
            deepLink: "https://app.datadoghq.com/monitors/manage",
            deepLinkStatus: "browser-discovered",
            endpoint: "/monitors/manage",
            observedAt: AT,
            surface: "console",
          },
          state: "observed",
        },
      },
      id: datadogEntityId({ kind: "console-page", providerId: "/monitors/manage" }),
      kind: "console-page",
      providerId: "/monitors/manage",
      scope: ORIGIN,
    });
  });

  it("leaves responseAccounting ABSENT for an unvisited page and marks a non-landed deep link unavailable", () => {
    const entity = pageEntity({
      at: AT,
      origin: ORIGIN,
      page: page({ outcome: "not-attempted", responseAccounting: null }),
    });
    const channel = entity.channels.console!;
    // `toStrictEqual`, because `toEqual` would accept a present-but-undefined `responseAccounting` key.
    expect(channel.detail).toStrictEqual({
      finalUrl: `${ORIGIN}/monitors/manage`,
      href: "/monitors/manage",
      label: "Monitors",
      outcome: "not-attempted",
      posture: "read",
      section: "monitors",
      statusCode: 200,
      title: "Manage Monitors",
    });
    expect(channel.source!.deepLinkStatus).toBe("unavailable");
    expect(channel.source!.deepLink).toBe("https://app.datadoghq.com/monitors/manage");
  });

  it("grades a redirected page's deep link unavailable even though it was visited", () => {
    const entity = pageEntity({
      at: AT,
      origin: ORIGIN,
      page: page({
        outcome: "redirected",
        responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 3 },
      }),
    });
    expect(entity.channels.console!.source!.deepLinkStatus).toBe("unavailable");
  });
});

describe("requestEntity", () => {
  it("keys a console-request by method plus path shape and carries names and statuses only", () => {
    const observed = request({
      method: "GET",
      pathShape: "/api/v1/dashboard/lists/manual",
      registry: surface({ name: "v1-dashboard-lists-list-dashboard-lists" }),
    });
    expect(requestEntity({ at: AT, origin: ORIGIN, request: observed })).toEqual({
      channels: {
        api: null,
        "compiled-catalogue": null,
        console: {
          channel: "console",
          detail: {
            method: "GET",
            observedOnPages: ["/dashboard/lists", "/monitors/manage"],
            paramNames: ["page", "page_size"],
            pathShape: "/api/v1/dashboard/lists/manual",
            registryOperation: "GET /api/v1/dashboard/lists/manual",
            responseFieldPaths: ["data[].id", "data[].name"],
            statusCodes: [200, 304],
          },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: {
            artifacts: [],
            deepLink: null,
            deepLinkStatus: "browser-discovered",
            endpoint: "GET /api/v1/dashboard/lists/manual",
            observedAt: AT,
            surface: "console",
          },
          state: "observed",
        },
      },
      id: datadogEntityId({ kind: "console-request", providerId: "GET /api/v1/dashboard/lists/manual" }),
      kind: "console-request",
      providerId: "GET /api/v1/dashboard/lists/manual",
      scope: ORIGIN,
    });
  });

  it("records a null registryOperation for a call no registry row declares", () => {
    const entity = requestEntity({
      at: AT,
      origin: ORIGIN,
      request: request({ method: "POST", pathShape: "/api/ui/search", registry: null }),
    });
    expect(entity.channels.console!.detail).toEqual({
      method: "POST",
      observedOnPages: ["/dashboard/lists", "/monitors/manage"],
      paramNames: ["page", "page_size"],
      pathShape: "/api/ui/search",
      registryOperation: null,
      responseFieldPaths: ["data[].id", "data[].name"],
      statusCodes: [200, 304],
    });
  });
});

describe("corroborations", () => {
  it("groups matched calls by registry kind, drops null and undeclared kinds, and dedupes one id per kind", () => {
    const dashboardRow = surface({ name: "v1-dashboard-lists-list-dashboard-lists" });
    const integrationRow = surface({ name: "v1-awsintegration-list-awsaccounts" });
    const unknownKindRow: DatadogSurfaceRow = { ...dashboardRow, kind: "not-a-datadog-kind", name: "made-up" };
    const first = request({ method: "GET", pathShape: "/api/v1/dashboard/lists/manual", registry: dashboardRow });
    const duplicate = request({ method: "GET", pathShape: "/api/v1/dashboard/lists/manual", registry: dashboardRow });
    const integration = request({ method: "GET", pathShape: "/api/v1/integration/aws", registry: integrationRow });
    const unmatched = request({ method: "GET", pathShape: "/api/ui/thing", registry: null });
    const unknown = request({ method: "GET", pathShape: "/api/v1/made-up", registry: unknownKindRow });

    const grouped = corroborations({
      at: AT,
      origin: ORIGIN,
      walk: walkOf({ requests: [first, unmatched, duplicate, integration, unknown] }),
    });

    expect(
      [...grouped.entries()].map(([kind, entities]) => [kind, entities.map((entity) => entity.providerId)]),
    ).toEqual([
      ["dashboard", ["v1-dashboard-lists-list-dashboard-lists"]],
      ["integration", ["v1-awsintegration-list-awsaccounts"]],
    ]);
    expect(grouped.get("dashboard")).toEqual([
      {
        channels: {
          api: null,
          "compiled-catalogue": null,
          console: {
            channel: "console",
            detail: {
              method: "GET",
              observedOnPages: ["/dashboard/lists", "/monitors/manage"],
              paramNames: ["page", "page_size"],
              pathShape: "/api/v1/dashboard/lists/manual",
              registryOperation: "GET /api/v1/dashboard/lists/manual",
              responseFieldPaths: ["data[].id", "data[].name"],
              statusCodes: [200, 304],
            },
            firstSeenAt: AT,
            lastSeenAt: AT,
            source: {
              artifacts: [],
              deepLink: null,
              deepLinkStatus: "browser-discovered",
              endpoint: "GET /api/v1/dashboard/lists/manual",
              observedAt: AT,
              surface: "console",
            },
            state: "observed",
          },
        },
        id: datadogEntityId({ kind: "dashboard", providerId: "v1-dashboard-lists-list-dashboard-lists" }),
        kind: "dashboard",
        providerId: "v1-dashboard-lists-list-dashboard-lists",
        scope: ORIGIN,
      },
    ]);
  });

  it("returns an empty map when no call corroborates a registry operation", () => {
    const grouped = corroborations({
      at: AT,
      origin: ORIGIN,
      walk: walkOf({ requests: [request({ method: "GET", pathShape: "/api/ui/x", registry: null })] }),
    });
    expect(grouped.size).toBe(0);
  });
});
