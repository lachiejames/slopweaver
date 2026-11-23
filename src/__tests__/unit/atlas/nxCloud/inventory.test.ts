import { describe, expect, it } from "vitest";

import { patternOfPath } from "../../../../atlas/nxCloud/browserReduction.js";
import {
  canonicalEndpointPattern,
  findNxCloudCall,
  isNxCloudCallId,
  NX_CLOUD_CALLS,
  NX_CLOUD_WALK_ROUTES,
  type NxCloudCallId,
  nxCloudCall,
  nxCloudPath,
} from "../../../../atlas/nxCloud/inventory.js";

describe("NX_CLOUD_CALLS", () => {
  it("gives every call a reason an atlas that changes nothing reads it", () => {
    expect(NX_CLOUD_CALLS.every((call) => call.whyRead.length > 0)).toBe(true);
  });

  it("declares every call's disposition, so a voluminous family is never stored by accident", () => {
    expect(NX_CLOUD_CALLS.map((call) => `${call.id}:${call.disposition}`)).toEqual([
      "organizations:entity",
      "org-workspaces:entity",
      "workspace-overview:entity",
      "workspace-runs:family",
      "workspace-insights:family",
    ]);
  });

  it("has no call whose path is not addressed under the platform's own origin", () => {
    expect(NX_CLOUD_CALLS.every((call) => call.pathTemplate.startsWith("/"))).toBe(true);
  });
});

describe("findNxCloudCall", () => {
  it("finds a declared call", () => {
    expect(findNxCloudCall({ id: "workspace-overview" })!.pathTemplate).toBe(
      "/orgs/:orgId/workspaces/:workspaceId/overview.data",
    );
  });

  it("answers null for a call this build does not declare, rather than building a URL from it", () => {
    expect(findNxCloudCall({ id: "delete-everything" })).toBe(null);
    expect(findNxCloudCall({ id: "constructor" })).toBe(null);
  });
});

describe("nxCloudCall", () => {
  it("resolves every declared id to the row that declares it", () => {
    expect(NX_CLOUD_CALLS.length).toBeGreaterThan(0);
    const strays = NX_CLOUD_CALLS.filter((call) => nxCloudCall({ id: call.id }) !== call);
    expect(strays.map((call) => call.id)).toEqual([]);
  });

  it("refuses an undeclared id at compile time, and the guard refuses it at run time", () => {
    // @ts-expect-error -- "delete-everything" is not a declared call id
    const unknown: NxCloudCallId = "delete-everything";
    expect(isNxCloudCallId(unknown)).toBe(false);
    expect(NX_CLOUD_CALLS.filter((call) => !isNxCloudCallId(call.id)).map((call) => call.id)).toEqual([]);
  });
});

describe("nxCloudPath", () => {
  it("substitutes both scope parameters", () => {
    expect(nxCloudPath({ orgId: "o", template: "/orgs/:orgId/workspaces/:workspaceId/runs", workspaceId: "w" })).toBe(
      "/orgs/o/workspaces/w/runs",
    );
  });

  it("leaves a template with no parameters alone", () => {
    expect(nxCloudPath({ orgId: "o", template: "/orgs.data", workspaceId: "w" })).toBe("/orgs.data");
  });
});

describe("canonicalEndpointPattern", () => {
  it("renders a template into the vocabulary the browser channel's own reduction produces", () => {
    const template = "/orgs/:orgId/workspaces/:workspaceId/runs.data";
    const concrete = "/orgs/0000000000000000000000a1/workspaces/0000000000000000000000b2/runs.data";
    expect(canonicalEndpointPattern({ template })).toBe(patternOfPath({ pathname: concrete }));
  });

  it("renders a run id with the run placeholder rather than the object one", () => {
    expect(canonicalEndpointPattern({ template: "/runs/:runId" })).toBe("/runs/<rid>");
  });
});

describe("NX_CLOUD_WALK_ROUTES", () => {
  it("declares the two pages a member role is known to be refused, so a gap can NAME them", () => {
    expect(NX_CLOUD_WALK_ROUTES).toContain("/orgs/:orgId/workspaces/:workspaceId/settings");
    expect(NX_CLOUD_WALK_ROUTES).toContain("/orgs/:orgId/settings");
  });

  it("names every route as a path pattern rather than a URL", () => {
    expect(NX_CLOUD_WALK_ROUTES.every((route) => route.startsWith("/"))).toBe(true);
  });
});
