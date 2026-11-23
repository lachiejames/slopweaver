/** The production wiring: every seam present, and an explicit `--repo` resolved with no checkout read. */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { productionGithubChecksDeps } from "../../../../../../cli/commands/github/checksDeps.js";

describe("productionGithubChecksDeps", () => {
  it("wires every seam the shell calls, resolving no credential until one is used", () => {
    const deps = productionGithubChecksDeps();

    expect(Object.keys(deps).toSorted()).toEqual([
      "fetchActivity",
      "fetchChecks",
      "fetchRequiredContexts",
      "now",
      "readJobLogs",
      "recordChecksRead",
      "recordWatchDone",
      "recordWatching",
      "resolveRepo",
      "sleep",
      "writeDiagnostic",
      "writeOut",
    ]);
  });

  it("parses an explicit --repo slug without touching the checkout", () => {
    expect(unwrap(productionGithubChecksDeps().resolveRepo({ explicit: "acme/widget" }))).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });
});
