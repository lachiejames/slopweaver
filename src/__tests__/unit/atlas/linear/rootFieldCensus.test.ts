import { describe, expect, it } from "vitest";

import { classifyRootFields, unclassifiedRootFields } from "../../../../atlas/linear/rootFieldCensus.js";

describe("classifyRootFields", () => {
  it("admits a root field the configuration inventory actually reads", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.workflowStates"] });
    expect(only!.classification).toBe("admitted-configuration");
  });

  it("classifies every mutation as never called, whatever it is named", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["mutation.somethingBrandNew"] });
    expect(only!.classification).toBe("mutation-not-called");
  });

  it("catalogues a subscription and records that it is never opened", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["subscription.issues"] });
    expect(only!.classification).toBe("subscription-not-opened");
  });

  it("excludes a corpus entity with the per-platform ruling as its reason", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.issues"] });
    expect(only!.classification).toBe("excluded-corpus");
    expect(only!.reason).toContain("SURFACE MAP");
  });

  it("excludes a singular reader of an admitted plural", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.workflowState"] });
    expect(only!.classification).toBe("excluded-singular");
  });

  it("excludes a search endpoint as query-shaped rather than shape-describing", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.searchIssues"] });
    expect(only!.classification).toBe("excluded-query-shaped");
  });

  it("refuses to call a probing endpoint a read", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.pushSubscriptionTest"] });
    expect(only!.classification).toBe("excluded-side-effecting");
  });

  it("excludes session state as sensitive", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.authenticationSessions"] });
    expect(only!.classification).toBe("excluded-sensitive");
  });

  it("excludes the audit log as voluminous", () => {
    const [only] = classifyRootFields({ operationProviderIds: ["query.auditEntries"] });
    expect(only!.classification).toBe("excluded-voluminous");
  });

  it("leaves a root field nobody placed UNCLASSIFIED rather than silently dropping it", () => {
    const classified = classifyRootFields({ operationProviderIds: ["query.somethingLinearAddedYesterday"] });
    expect(classified[0]!.classification).toBe("unclassified");
    expect(unclassifiedRootFields({ classified })).toEqual(["query.somethingLinearAddedYesterday"]);
  });

  it("returns nothing unclassified for a query root field the census places", () => {
    const classified = classifyRootFields({ operationProviderIds: ["query.teams", "query.issues"] });
    expect(unclassifiedRootFields({ classified })).toEqual([]);
  });

  it("orders its answer by provider key, so two runs write identical bytes", () => {
    const classified = classifyRootFields({ operationProviderIds: ["query.teams", "mutation.teamCreate"] });
    expect(classified.map((field) => field.providerId)).toEqual(["mutation.teamCreate", "query.teams"]);
  });
});
