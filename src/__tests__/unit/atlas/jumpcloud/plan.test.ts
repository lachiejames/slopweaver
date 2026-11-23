import { describe, expect, it } from "vitest";

import { JUMPCLOUD_SURFACES } from "../../../../atlas/jumpcloud/generated/surfaces.js";
import { JUMPCLOUD_KINDS } from "../../../../atlas/jumpcloud/model.js";
import {
  bindingRootFor,
  isShapeIndexedKind,
  planJumpcloudKind,
  planJumpcloudSync,
  providerIdOf,
} from "../../../../atlas/jumpcloud/plan.js";

describe("bindingRootFor", () => {
  it("binds a saas-management fan-out from the applications collection, never from the application catalogue", () => {
    const plan = planJumpcloudKind({ kind: "saas-management" });
    const fanout = plan.fanouts.find((operation) => operation.row.name === "v2-get-application")!;

    expect(bindingRootFor({ fanout, roots: plan.roots })?.row.path).toBe("/api/v2/saas-management/applications");
  });

  it("keeps a sub-resource on the same parent as the resource above it", () => {
    const plan = planJumpcloudKind({ kind: "saas-management" });
    const usage = plan.fanouts.find((operation) => operation.row.name === "v2-get-application-usage")!;

    expect(bindingRootFor({ fanout: usage, roots: plan.roots })?.row.path).toBe("/api/v2/saas-management/applications");
  });

  it("tells two sibling collections of one kind apart, so a run is never bound from a workflow's runs", () => {
    const plan = planJumpcloudKind({ kind: "workflows" });
    const workflow = plan.fanouts.find((operation) => operation.row.name === "v2-get-workflow")!;
    const run = plan.fanouts.find((operation) => operation.row.name === "v2-get-workflow-run")!;

    expect(bindingRootFor({ fanout: workflow, roots: plan.roots })?.row.path).toBe("/api/v2/workflows");
    expect(bindingRootFor({ fanout: run, roots: plan.roots })?.row.path).toBe("/api/v2/workflows/runs");
  });

  it("answers null when no admitted root is the parent, which is what sends the caller to the kind's pool", () => {
    const plan = planJumpcloudKind({ kind: "systems" });
    const fanout = plan.fanouts.find((operation) => operation.row.path.endsWith("/policystatuses"))!;

    expect(bindingRootFor({ fanout, roots: plan.roots })).toBe(null);
  });
});

describe("planJumpcloudKind", () => {
  it("reads the systems collection with no binding at all, so its ids can bind everything else", () => {
    const plan = planJumpcloudKind({ kind: "systems" });
    expect(plan.roots.map((operation) => operation.row.name).includes("v1-systems-list")).toBe(true);
  });

  it("puts a one-parameter operation in the fan-out, bound from its own kind's ids", () => {
    const plan = planJumpcloudKind({ kind: "systems" });
    const fanout = plan.fanouts.find((operation) => operation.row.path.endsWith("/policystatuses"));
    expect(fanout?.parameters).toEqual(["system_id"]);
  });

  it("refuses to invent a request body, and says the family is covered by its own collection", () => {
    const plan = planJumpcloudKind({ kind: "search" });
    expect(plan.roots.length).toBe(0);
    expect(plan.unrunnable.every((entry) => entry.reason === "request-body-unpinned")).toBe(true);
  });

  it("reports a nested parameter rather than dropping the operation out of the plan", () => {
    const plan = planJumpcloudKind({ kind: "providers" });
    const nested = plan.unrunnable.filter((entry) => entry.reason === "nested-parameter");
    expect(nested.length).toBeGreaterThan(0);
    expect(nested[0]!.detail).toContain("only the first has a derivable source");
  });

  it("keeps an inventoried-and-refused row visible, so a reader learns the endpoint exists", () => {
    const plan = planJumpcloudKind({ kind: "applemdms" });
    expect(plan.excluded.length).toBeGreaterThan(0);
    expect(plan.excluded.every((row) => row.coverage === "excluded")).toBe(true);
  });

  it("never plans a call for an excluded row", () => {
    const excluded = new Set(JUMPCLOUD_SURFACES.filter((row) => row.coverage === "excluded").map((row) => row.name));
    const planned = planJumpcloudSync().flatMap((plan) => [...plan.roots, ...plan.fanouts]);
    expect(planned.filter((operation) => excluded.has(operation.row.name)).length).toBe(0);
  });

  it("accounts for every reachable row exactly once, so nothing vanishes from the plan", () => {
    const reachable = JUMPCLOUD_SURFACES.filter((row) => row.coverage === "reachable").length;
    const accounted = planJumpcloudSync().reduce(
      (total, plan) => total + plan.roots.length + plan.fanouts.length + plan.unrunnable.length,
      0,
    );
    expect(accounted).toBe(reachable);
  });

  it("plans one entry per declared kind", () => {
    expect(planJumpcloudSync().map((plan) => plan.kind)).toEqual([...JUMPCLOUD_KINDS]);
  });
});

describe("isShapeIndexedKind", () => {
  it("holds exactly the two event-telemetry families the ruling names", () => {
    expect(isShapeIndexedKind({ kind: "events" })).toBe(true);
    expect(isShapeIndexedKind({ kind: "commandresults" })).toBe(true);
    expect(isShapeIndexedKind({ kind: "systems" })).toBe(false);
  });
});

describe("providerIdOf", () => {
  it("prefers the provider's own key over anything derived", () => {
    expect(providerIdOf({ record: { _id: "abc", name: "laptop" } })).toBe("abc");
  });

  it("falls back through v2's spelling", () => {
    expect(providerIdOf({ record: { id: "def", name: "laptop" } })).toBe("def");
  });

  it("reports no id rather than inventing one", () => {
    expect(providerIdOf({ record: { hostname: "laptop" } })).toBe(null);
    expect(providerIdOf({ record: "not an object" })).toBe(null);
  });
});
