/*
 * The console row the desktop menu bar's plan lines read (`desktop/src/planUsageShell.ts`): the exact argv, so the
 * slug can never drift onto a verb that asks a model host, and the empty register read as an answer.
 */
import { describe, expect, it } from "vitest";

import { liveVerbFor } from "../../lib/liveVerbs";

describe("the plan-usage live verb", () => {
  it("runs the local `plans usage --json` read on the fast lane, stamped by the verb itself", () => {
    expect(liveVerbFor({ slug: "plan-usage" })).toEqual({
      argv: ["plans", "usage", "--json"],
      expectedEmpty: { code: "NO_PLANS", exitCode: 3 },
      format: "json",
      lane: "fast",
      slug: "plan-usage",
      stampsItsOwnTime: true,
      timeoutMs: 20_000,
      title: "slopweaver plans usage --json",
    });
  });
});
