import { describe, expect, it } from "vitest";

import {
  endpointEntityId,
  familyEntityId,
  organizationEntityId,
  routeEntityId,
  workspaceEntityId,
} from "../../../../atlas/nxCloud/identity.js";

describe("nx-cloud entity identity", () => {
  it("gives one workspace the same id every run, which is what makes accumulate-never-replace work", () => {
    expect(workspaceEntityId({ workspaceId: "w1" })).toBe(workspaceEntityId({ workspaceId: "w1" }));
  });

  it("keys a workspace by its own id alone, so moving it between organisations keeps one identity", () => {
    expect(workspaceEntityId({ workspaceId: "w1" })).not.toBe(workspaceEntityId({ workspaceId: "w2" }));
  });

  it("never collides an organisation with a workspace of the same provider id", () => {
    expect(organizationEntityId({ organizationId: "x" })).not.toBe(workspaceEntityId({ workspaceId: "x" }));
  });

  it("keys a route by its path pattern, so one page is one entity however many workspaces are walked", () => {
    expect(routeEntityId({ pathPattern: "/orgs/:orgId/workspaces/:workspaceId/runs" })).toBe(
      routeEntityId({ pathPattern: "/orgs/:orgId/workspaces/:workspaceId/runs" }),
    );
  });

  it("keys an endpoint by method AND pattern, so two verbs on one path are two entities", () => {
    expect(endpointEntityId({ method: "GET", pathPattern: "/x" })).not.toBe(
      endpointEntityId({ method: "POST", pathPattern: "/x" }),
    );
  });

  it("scopes a family to its workspace, because the measurement it carries is per workspace", () => {
    expect(familyEntityId({ family: "run", workspaceId: "w1" })).not.toBe(
      familyEntityId({ family: "run", workspaceId: "w2" }),
    );
  });

  it("gives every id a fixed width, so a stored file's shape does not vary with its input", () => {
    expect(organizationEntityId({ organizationId: "a" }).length).toBe(32);
  });
});
