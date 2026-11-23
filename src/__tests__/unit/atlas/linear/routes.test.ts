import { describe, expect, it } from "vitest";

import { LINEAR_ROUTE_TEMPLATES, planLinearPages } from "../../../../atlas/linear/routes.js";

describe("planLinearPages", () => {
  it("has at least one entry in LINEAR_ROUTE_TEMPLATES, so the guards below are not vacuously green", () => {
    expect(LINEAR_ROUTE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("instantiates every per-team template once per team", () => {
    const perTeam = LINEAR_ROUTE_TEMPLATES.filter((template) => template.perTeam).length;
    const workspace = LINEAR_ROUTE_TEMPLATES.length - perTeam;
    const planned = planLinearPages({ teamKeys: ["AAA", "BBB"], urlKey: "acme" });
    expect(planned.length).toBe(workspace + perTeam * 2);
  });

  it("substitutes the team key into the path and the URL alike", () => {
    const planned = planLinearPages({ teamKeys: ["AAA"], urlKey: "acme" });
    const workflow = planned.find((page) => page.providerId === "/settings/teams/AAA/workflow")!;
    expect(workflow.url).toBe("https://linear.app/acme/settings/teams/AAA/workflow");
    expect(workflow.pageScope).toBe("AAA");
  });

  it("scopes a workspace route to the workspace", () => {
    const planned = planLinearPages({ teamKeys: ["AAA"], urlKey: "acme" });
    expect(planned.find((page) => page.providerId === "/settings/members")!.pageScope).toBe("workspace");
  });

  it("plans only the workspace routes when a workspace has no teams", () => {
    const planned = planLinearPages({ teamKeys: [], urlKey: "acme" });
    expect(planned.every((page) => page.pageScope === "workspace")).toBe(true);
  });

  it("declares no route with an unsubstituted placeholder left in it", () => {
    const planned = planLinearPages({ teamKeys: ["AAA"], urlKey: "acme" });
    expect(planned.filter((page) => page.url.includes("{team}"))).toEqual([]);
  });

  it("every declared template is under the settings path, so no action route can enter the walk", () => {
    expect(LINEAR_ROUTE_TEMPLATES.filter((template) => !template.path.startsWith("/settings/"))).toEqual([]);
  });
});
