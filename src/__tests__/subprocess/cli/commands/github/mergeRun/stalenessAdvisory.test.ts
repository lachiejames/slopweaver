/**
 * The `github merge` report's staleness advisory. Fast tests inject plain fake edges (no mocks).
 */
import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../../cli/commands/github/errors.js";
import { runGithubMerge } from "../../../../../../cli/commands/github/mergeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { capturingOut, depsWith, VERB_ARGV } from "./harness.js";

describe("the staleness advisory on the report", () => {
  /** The one count every case here injects, so an absent line is always an absence of a count that WAS there. */
  const BEHIND_BY = 4;
  const ADVISORY = "⚠ this branch is 4 commits behind origin/main";

  it("leads the report with how far behind the base the worktree is", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({ countBehindBase: () => ok(BEHIND_BY), out: captured.out }),
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.lines[2]).toBe(ADVISORY);
  });

  it("changes no exit code — the same clean report exits OK with the advisory above it", async () => {
    const quiet = capturingOut();
    const quietCode = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({ countBehindBase: () => ok(0), out: quiet.out }),
    });

    expect(quietCode).toBe(EXIT_OK);
    expect(quiet.lines.includes(ADVISORY)).toBe(false);
    expect(quiet.lines[2]).toContain("measured in tree: /repo");
  });

  it("stays silent against a LOCAL fallback base, where the same count would under-report", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        countBehindBase: () => ok(BEHIND_BY),
        out: captured.out,
        resolveBase: () => ({ branch: "main", fetchedFrom: undefined, revision: "main", why: "no network" }),
      }),
    });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.lines.includes(ADVISORY)).toBe(false);
    expect(captured.lines.join("\n")).toContain("base-unresolved");
  });

  it("stays silent when the count itself could not be taken, rather than guessing one", async () => {
    const captured = capturingOut();
    const code = await runGithubMerge({
      argv: [...VERB_ARGV],
      deps: depsWith({
        countBehindBase: () => err(GithubVerbErrors.revListUnparsed({ cwd: "/repo", text: "git rev-list failed" })),
        out: captured.out,
      }),
    });

    expect(code).toBe(EXIT_OK);
    expect(captured.lines.includes(ADVISORY)).toBe(false);
    expect(captured.lines[2]).toContain("measured in tree: /repo");
  });
});
