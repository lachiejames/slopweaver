/** The required-contexts gate: a head whose base requires a context that never ran is refused, read once. */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { depsFor, PASSED_CHECK, RUNNING_CHECK, snapshot } from "./harness.js";

describe("runGithubChecks", () => {
  it("refuses a rollup-SUCCESS head whose required context never ran, naming it, and never exits OK", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    // The measured shape: `main` requires build + integration; a CONFLICTING pull request runs neither, while
    // CodeQL still passes and carries the rollup to SUCCESS. Nothing here is failing, running or queued.
    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic,
        fetches: [
          {
            ...snapshot({ checks: [{ kind: "check-run", name: "CodeQL", state: "passed", url: undefined }] }),
            rollupState: "SUCCESS",
          },
        ],
        out,
        required: ["build", "integration"],
      }),
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual(["1/1 checks passed (rollup SUCCESS), 2 REQUIRED CONTEXTS NEVER RAN: build, integration"]);
    expect(diagnostic).toHaveLength(1);
    expect(diagnostic[0]).toContain("refused: main requires build, integration");
  });

  it("exits OK, naming the required set beside the count, once every required context is on the head", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic,
        fetches: [
          {
            ...snapshot({
              checks: [
                { kind: "check-run", name: "build", state: "passed", url: undefined },
                { kind: "check-run", name: "integration", state: "passed", url: undefined },
              ],
            }),
            rollupState: "SUCCESS",
          },
        ],
        out,
        required: ["build", "integration"],
      }),
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["2/2 checks passed (rollup SUCCESS), 2/2 required present"]);
    expect(diagnostic).toEqual([]);
  });

  it("reads the required set ONCE across a --wait lap, not once per poll", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let requiredReads = 0;
    const deps = depsFor({
      diagnostic,
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });

    const code = await runGithubChecks({
      deps: {
        ...deps,
        fetchRequiredContexts: ({ branch }) => {
          requiredReads += 1;
          return Promise.resolve(ok({ branch, contexts: [], requiresCodeOwnerReviews: undefined }));
        },
      },
      rest: ["--number", "9", "--wait"],
    });

    expect(code).toBe(EXIT_OK);
    expect(requiredReads).toBe(1);
  });

  it("says the gate was UNREAD, and does not refuse, when the required-contexts read fails", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const deps = depsFor({ diagnostic, fetches: [snapshot({ checks: [PASSED_CHECK] })], out });

    const code = await runGithubChecks({
      deps: {
        ...deps,
        fetchRequiredContexts: () =>
          Promise.resolve(err(GithubLiveErrors.readFailed({ message: "branch protection is admin-only" }))),
      },
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      "1/1 checks passed (rollup PENDING), required contexts UNREAD (branch protection is admin-only) — " +
        "a required gate that never ran cannot be ruled out here",
    ]);
  });
});
