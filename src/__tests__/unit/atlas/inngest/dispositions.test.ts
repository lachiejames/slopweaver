import { describe, expect, it } from "vitest";

import { INNGEST_DISPOSITION_RULES, inngestDispositionFor } from "../../../../atlas/inngest/dispositions.js";
import type { InngestCatalogueOperation } from "../../../../atlas/inngest/restCatalogue.js";

/** One catalogue row, with only the fields a disposition rule reads varied. */
function operation({
  operationId,
  group = "Runs",
}: {
  operationId: string;
  group?: string;
}): InngestCatalogueOperation {
  return {
    description: null,
    group,
    operationId,
    referenceUrl: `https://api-docs.inngest.com/v2/runs/${operationId}`,
    title: operationId,
    version: "v2",
  };
}

describe("deciding what this atlas may do with one operation", () => {
  it("holds a mutation as a row and refuses to call it", () => {
    const verdict = inngestDispositionFor({ operation: operation({ operationId: "CreateWebhook" }) });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.ruleId).toBe("mutating-operation");
  });

  // The criterion cuts THROUGH a family rather than along it: listing runs returns observations, listing the
  // schemas of the event types those runs came from returns configuration somebody's codebase declared.
  it("separates a time-series listing from a configuration listing in the same product area", () => {
    expect(inngestDispositionFor({ operation: operation({ operationId: "ListRuns" }) }).disposition).toBe("voluminous");
    expect(
      inngestDispositionFor({ operation: operation({ group: "Insights", operationId: "ListInsightsEventSchemas" }) })
        .disposition,
    ).toBe("reachable");
  });

  // Order is load-bearing: an operation that both writes and returns observations is EXCLUDED, because the
  // reason this atlas will not call it is the write, and grading it voluminous would claim it was looked at.
  it("grades a mutation that also returns observations as excluded rather than voluminous", () => {
    const verdict = inngestDispositionFor({ operation: operation({ operationId: "CancelRun" }) });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.ruleId).toBe("mutating-operation");
  });

  it("refuses to read bytes out of a running sandbox, separately from the mutation rule", () => {
    const verdict = inngestDispositionFor({ operation: operation({ operationId: "ReadSandboxFile" }) });
    expect(verdict.disposition).toBe("excluded");
    expect(verdict.ruleId).toBe("sandbox-filesystem-read");
  });

  it("falls through to configuration for an operation no earlier rule claims", () => {
    const verdict = inngestDispositionFor({ operation: operation({ group: "Apps", operationId: "GetApps" }) });
    expect(verdict.disposition).toBe("reachable");
    expect(verdict.ruleId).toBe("configuration-read");
  });

  it("gives every rule a reason a reader can act on, including the one that matches everything", () => {
    expect(INNGEST_DISPOSITION_RULES.filter((rule) => rule.reason.trim() === "").length).toBe(0);
    expect(INNGEST_DISPOSITION_RULES.at(-1)!.matches({ operation: operation({ operationId: "anything" }) })).toBe(true);
  });
});
