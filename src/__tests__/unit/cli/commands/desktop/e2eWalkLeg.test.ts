import { describe, expect, it } from "vitest";

import { walkLeg } from "../../../../../cli/commands/desktop/e2eWalkLeg.js";
import { unwrap } from "../../../../../lib/result.js";

describe("walkLeg", () => {
  it("walks nothing for a run that asked only for calls: no instance, no hold read, no step", async () => {
    const reads: string[] = [];
    const lines: string[] = [];
    const walked = await walkLeg({
      app: "/nonexistent/Slopweaver.app",
      checkout: "/nonexistent/checkout",
      context: undefined,
      menuBar: false,
      onCall: () => {
        reads.push("on-call");
        return undefined;
      },
      out: "/nonexistent/out",
      progress: () => {
        lines.push("step");
      },
      settleCapMs: 30_000,
      steps: [],
    });
    expect(unwrap(walked)).toEqual({ held: undefined, results: [] });
    expect([reads, lines]).toEqual([[], []]);
  });
});
