import { ForbiddenLinearError, RatelimitedLinearError } from "@linear/sdk";
import { describe, expect, it } from "vitest";

import type { LinearApi } from "../../../../corpus/linear/apiTypes.js";
import { entityLane, fetchLinearCurated, fetchLinearRecordEntities } from "../../../../corpus/linear/fetchLanes.js";

/** A seam whose two walking lanes are empty, so only the bounded lanes under test do anything. */
const baseApi = (over: Partial<LinearApi> = {}): LinearApi => ({
  issues: async () => ({ historyRows: [], issues: [] }),
  projects: async () => ({ projects: [] }),
  users: async () => ({ nodes: [] }),
  ...over,
});

/** A live answer, once the workspace switched Customer Requests off. */
const CUSTOMER_REQUESTS_OFF = "Customer requests are not available in this workspace.";

describe("entityLane", () => {
  it("yields nothing and records nothing for a lane this deployment does not have", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    expect(await entityLane({ fetch: undefined, incomplete, label: "customerNeeds", warnings })).toEqual([]);
    expect(incomplete).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("walks every page of a lane that answers", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    const nodes = await entityLane({
      fetch: async ({ cursor }) => (cursor === undefined ? { nextCursor: "c2", nodes: ["a"] } : { nodes: ["b"] }),
      incomplete,
      label: "customerNeeds",
      warnings,
    });
    expect(nodes).toEqual(["a", "b"]);
    expect(incomplete).toEqual([]);
  });

  it("names a lane that threw as incomplete rather than throwing", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    const nodes = await entityLane({
      fetch: async () => {
        throw new Error("schema drift");
      },
      incomplete,
      label: "projectMilestones",
      warnings,
    });
    expect(nodes).toEqual([]);
    expect(incomplete).toEqual(["linear projectMilestones lane unavailable: schema drift"]);
    expect(warnings).toEqual([]);
  });

  it("records a lane Linear answers Forbidden as a warning, so it cannot hold the cursor", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    const nodes = await entityLane({
      fetch: async () => {
        throw new ForbiddenLinearError({ message: CUSTOMER_REQUESTS_OFF });
      },
      incomplete,
      label: "customerNeeds",
      warnings,
    });
    expect(nodes).toEqual([]);
    expect(incomplete).toEqual([]);
    expect(warnings).toEqual([
      `linear customerNeeds lane is forbidden for this token or workspace, so it holds nothing: ${CUSTOMER_REQUESTS_OFF}`,
    ]);
  });

  it("keeps a recoverable Linear error, such as a rate limit, incomplete", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    await entityLane({
      fetch: async () => {
        throw new RatelimitedLinearError({ message: "Rate limit exceeded" });
      },
      incomplete,
      label: "initiativeUpdates",
      warnings,
    });
    expect(incomplete).toEqual(["linear initiativeUpdates lane unavailable: Rate limit exceeded"]);
    expect(warnings).toEqual([]);
  });

  it("names a walk that repeated its cursor as incomplete", async () => {
    const incomplete: string[] = [];
    const warnings: string[] = [];
    await entityLane({
      fetch: async () => ({ nextCursor: "same", nodes: ["a"] }),
      incomplete,
      label: "templates",
      warnings,
    });
    expect(incomplete).toEqual([
      "linear templates may be incomplete: the endpoint repeated pagination cursor same instead of advancing",
    ]);
  });
});

describe("fetchLinearCurated", () => {
  it("keeps a page's nested-connection notes advisory while a failed lane is incomplete", async () => {
    const result = await fetchLinearCurated({
      api: baseApi({
        documents: async () => {
          throw new Error("documents not enabled");
        },
        initiatives: async () => ({ initiatives: [], warnings: ["initiative projects overflowed on I-1"] }),
      }),
    });
    expect(result.warnings).toEqual(["initiative projects overflowed on I-1"]);
    expect(result.incomplete).toEqual(["linear documents lane unavailable: documents not enabled"]);
  });

  it("records a curated lane Linear answers Forbidden as a warning", async () => {
    const result = await fetchLinearCurated({
      api: baseApi({
        documents: async () => {
          throw new ForbiddenLinearError({ message: "Documents are not available in this workspace." });
        },
      }),
    });
    expect(result.incomplete).toEqual([]);
    expect(result.warnings).toEqual([
      "linear documents lane is forbidden for this token or workspace, so it holds nothing: " +
        "Documents are not available in this workspace.",
    ]);
  });
});

describe("fetchLinearRecordEntities", () => {
  it("names the one-call templates lane as incomplete when it throws", async () => {
    const result = await fetchLinearRecordEntities({
      api: baseApi({
        templates: async () => {
          throw new Error("forbidden");
        },
      }),
    });
    expect(result.templates).toEqual([]);
    expect(result.incomplete).toEqual(["linear templates lane unavailable: forbidden"]);
    expect(result.warnings).toEqual([]);
  });

  it("returns a Forbidden customerNeeds lane among its warnings while the other lanes still arrive", async () => {
    const result = await fetchLinearRecordEntities({
      api: baseApi({
        customerNeeds: async () => {
          throw new ForbiddenLinearError({ message: CUSTOMER_REQUESTS_OFF });
        },
        projectMilestones: async () => ({ nodes: ["m1"] }),
      }),
    });
    expect(result.customerNeeds).toEqual([]);
    expect(result.projectMilestones).toEqual(["m1"]);
    expect(result.incomplete).toEqual([]);
    expect(result.warnings).toEqual([
      `linear customerNeeds lane is forbidden for this token or workspace, so it holds nothing: ${CUSTOMER_REQUESTS_OFF}`,
    ]);
  });
});
