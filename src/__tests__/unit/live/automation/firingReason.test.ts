/**
 * A slot ledger detail cut to its reason, the one parser the fleet-health monitor and the Automations page share.
 */
import { describe, expect, it } from "vitest";

import { firingReason } from "../../../../live/automation/firingReason.js";

describe("firingReason", () => {
  it("cuts a verb row to its exit code and the verb's own why, dropping the command line", () => {
    const detail =
      "recipe resync-corpus-linear · ran · slopweaver automation resync --source linear · exit 1 · why: refresh: every selected source is already being refreshed";

    expect(firingReason({ detail, recipeId: "resync-corpus-linear" })).toBe(
      "exit 1: refresh: every selected source is already being refreshed",
    );
  });

  it("keeps the exit code alone when the verb gave no why", () => {
    expect(firingReason({ detail: "recipe r · ran · slopweaver store backup · exit 2", recipeId: "r" })).toBe("exit 2");
  });

  it("cuts only the row's own prefix, leaving any other detail whole", () => {
    expect([
      firingReason({ detail: "recipe r · lease expired", recipeId: "r" }),
      firingReason({ detail: "recipe other · lease expired", recipeId: "r" }),
    ]).toEqual(["lease expired", "recipe other · lease expired"]);
  });
});
