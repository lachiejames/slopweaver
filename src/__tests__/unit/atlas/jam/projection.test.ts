/**
 * What reaches disk, and the key the two channels are matched on.
 *
 * The provider key is the load-bearing part: a call the application makes and an operation the description
 * declares land on ONE entity only if both spell the key identically, and the corroboration this atlas
 * exists to produce is exactly that join.
 */
import { describe, expect, it } from "vitest";

import type { JamPageObservation } from "../../../../atlas/jam/browserWalk.js";
import {
  jamObservedCallProviderId,
  jamOperationProviderId,
  projectJamIntegration,
  projectJamObservedCall,
  projectJamOperation,
  projectJamPage,
  projectJamRoute,
  projectJamScope,
} from "../../../../atlas/jam/projection.js";

const AT = "2026-09-07T00:00:00.000Z";

describe("provider keys", () => {
  it("spells a documented call exactly as the compiled operation does, so the two channels merge", () => {
    const declared = jamOperationProviderId({ method: "GET", path: "/whoami" });
    const observed = jamObservedCallProviderId({
      call: { method: "GET", origin: "https://api.jam.dev", pathShape: "/whoami" },
    });
    expect(observed).toBe(declared);
  });

  it("carries the ORIGIN for a call to any other Jam host, so two services are never one endpoint", () => {
    expect(
      jamObservedCallProviderId({
        call: { method: "POST", origin: "https://mcp.jam.dev", pathShape: "/mcp" },
      }),
    ).toBe("POST https://mcp.jam.dev/mcp");
  });
});

describe("compiled projections", () => {
  it("keeps only names on an operation, and links back to the document it came from", () => {
    const entity = projectJamOperation({
      at: AT,
      row: {
        callable: true,
        excludedBecause: null,
        kind: "operation",
        method: "GET",
        parameters: ["client_id"],
        path: "/whoami",
        responseFields: ["user.id"],
        scopes: [],
        security: ["BearerAuth"],
        serverUrl: "https://api.jam.dev",
        synopsis: "Identity",
        tag: "Identity",
      },
    });
    expect(entity.providerId).toBe("GET /whoami");
    expect(entity.channels.browser).toBe(null);
    expect(entity.channels.api).toBe(null);
    expect(entity.channels.compiled?.source?.deepLink).toBe("https://api.jam.dev/openapi.json");
    expect(entity.channels.compiled?.source?.deepLinkStatus).toBe("provider-provided");
  });

  it("keys a route on its host as well as its method and path, because /mcp means two things", () => {
    const onApi = projectJamRoute({
      at: AT,
      row: {
        contentType: "application/json",
        control: false,
        host: "https://api.jam.dev",
        method: "GET",
        path: "/mcp",
        statusCode: 404,
        verdict: "routed-no-leaf",
      },
    });
    const onMcp = projectJamRoute({
      at: AT,
      row: {
        contentType: "application/json",
        control: false,
        host: "https://mcp.jam.dev",
        method: "GET",
        path: "/mcp",
        statusCode: 401,
        verdict: "answered",
      },
    });
    expect(onApi.providerId).toBe("GET https://api.jam.dev/mcp");
    expect(onMcp.providerId).toBe("GET https://mcp.jam.dev/mcp");
    expect(onApi.id).not.toBe(onMcp.id);
  });

  it("says a route row has no deep link rather than inventing one", () => {
    const entity = projectJamRoute({
      at: AT,
      row: {
        contentType: "text/plain",
        control: true,
        host: "https://api.jam.dev",
        method: "GET",
        path: "/zzz-control-must-not-exist",
        statusCode: 404,
        verdict: "not-routed",
      },
    });
    expect(entity.channels.compiled?.source?.deepLink).toBe(null);
    expect(entity.channels.compiled?.source?.deepLinkStatus).toBe("unavailable");
  });

  it("keys a scope on the scope string and an integration on its slug", () => {
    const scope = projectJamScope({
      at: AT,
      row: { claimedByResources: ["api-protected-resource"], namedBy: [], scope: "mcp:read" },
    });
    const integration = projectJamIntegration({
      at: AT,
      row: { pageUrl: "https://jam.dev/integrations/linear", slug: "linear" },
    });
    expect(scope.providerId).toBe("mcp:read");
    expect(integration.providerId).toBe("linear");
    expect(integration.channels.compiled?.source?.deepLink).toBe("https://jam.dev/integrations/linear");
  });
});

describe("browser projections", () => {
  /** One page observation with only the fields the projection reads varied. */
  function page(over: Partial<JamPageObservation> = {}): JamPageObservation {
    return {
      artifacts: [],
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: "https://jam.dev/s/team-0000/settings",
      observedAt: "2026-09-07T00:00:00.000Z",
      redirected: false,
      requestedUrl: "https://jam.dev/s/team-0000/settings",
      responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 40 },
      screenshotMissingBecause: null,
      statusCode: 200,
      surface: "settings",
      title: "Jam",
      unreachableBecause: null,
      ...over,
    };
  }

  it("records a landed page as browser-discovered, keyed on its SURFACE rather than its URL", () => {
    const entity = projectJamPage({ at: AT, page: page() });
    expect(entity.providerId).toBe("settings");
    expect(entity.channels.browser?.source?.deepLinkStatus).toBe("browser-discovered");
    expect(entity.channels.compiled).toBe(null);
  });

  it("carries no deep LINK, because the address under the application prefix holds a team identifier", () => {
    const entity = projectJamPage({ at: AT, page: page() });
    expect(entity.channels.browser?.source?.deepLink).toBe(null);
    expect(entity.channels.browser?.source?.endpoint).toBe("settings");
  });

  it("records WHY an unreached route is held, rather than leaving it absent", () => {
    const entity = projectJamPage({
      at: AT,
      page: page({ unreachableBecause: "the application rendered its own not-found page here" }),
    });
    expect(JSON.stringify(entity.channels.browser?.detail)).toContain("rendered its own not-found page");
  });

  it("stamps the WALK's own instant on the observation, not this run's", () => {
    const entity = projectJamPage({ at: AT, page: page({ observedAt: "2026-09-07T01:02:03.000Z" }) });
    expect(entity.channels.browser?.source?.observedAt).toBe("2026-09-07T01:02:03.000Z");
    expect(entity.channels.browser?.firstSeenAt).toBe(AT);
  });

  it("records an observed call's method, origin and shape and no response field at all", () => {
    const entity = projectJamObservedCall({
      at: AT,
      call: { method: "POST", origin: "https://jam.dev", pathShape: "/v1/input/{id}" },
    });
    const detail = JSON.parse(JSON.stringify(entity.channels.browser?.detail));
    expect(Object.keys(detail).toSorted()).toEqual(["method", "origin", "pathShape"]);
  });
});
