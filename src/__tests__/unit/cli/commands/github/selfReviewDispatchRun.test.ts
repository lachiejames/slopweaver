import { describe, expect, it } from "vitest";

import { runGithubSelfReview } from "../../../../../cli/commands/github/selfReviewDispatchRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("runGithubSelfReview", () => {
  it("refuses with usage on an unknown or missing sub-verb", () => {
    const diagnostics: string[] = [];
    const code = runGithubSelfReview({
      argv: ["node", "slopweaver", "github", "self-review", "delete"],
      deps: { writeDiagnostic: (line) => diagnostics.push(line) },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("usage: slopweaver github self-review <release> [...]");
  });
});
