/*
 * The stack push's adapter onto the create path's deps: a create diagnostic (the carried-review notice, the
 * moved-head warning) prints where the stack push prints, never into a no-op.
 */
import { describe, expect, it } from "vitest";

import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { toGithubPrDeps } from "../../../../../cli/commands/github/stackPushDeps.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

describe("toGithubPrDeps", () => {
  it("prints the create path's diagnostics on the stack push's own output", () => {
    const lines: string[] = [];
    const prDeps = toGithubPrDeps({
      deps: {
        autonomy: memoryAutonomyLedgerPort(),
        cwd: () => "/repo",
        descriptionReview: clearDescriptionReview,
        doorLedger: memoryDoorLedger().port,
        now: () => new Date("2026-11-25T00:00:00Z"),
        sleep: () => Promise.resolve(),
      },
      out: ({ line }) => lines.push(line),
    });
    prDeps.out({ line: "progress" });
    prDeps.err({ line: "description review: the description is unchanged" });
    expect(lines).toStrictEqual(["progress", "description review: the description is unchanged"]);
  });
});
