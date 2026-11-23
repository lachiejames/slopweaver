/** `slopweaver github enqueue --json`: the outcome label it prints never disagrees with its exit code. */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import { isRecord } from "../../../../../../lib/parsers.js";
import { pr } from "./fixtures.js";
import { api, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("the --json outcome label never disagrees with the exit code", () => {
  it("says unconfirmed, not queued, when the GraphQL enqueue read back with no entry", async () => {
    const out: string[] = [];
    const calls = noCalls();

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "json-label" }),
        out,
        // Both reads answer an unqueued pull request, so the mutation lands and the witness finds nothing.
        surface: api({ calls, reads: [pr(), pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--json"],
    });

    expect(code).toBe(1);
    const report: unknown = JSON.parse(out.join("\n"));
    expect(isRecord(report) ? report["outcome"] : undefined).toBe("unconfirmed");
    expect(isRecord(report) ? report["entry"] : undefined).toBeNull();
  });
});
