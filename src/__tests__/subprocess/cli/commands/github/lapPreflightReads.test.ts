/**
 * `planSourcesDiffering` over real git: the local side of the comparison is the running CLI's own tree, never the
 * directory the lap was invoked from, while the head is still read through the invoking checkout's git. A runner
 * checked out at a batch's CI change, invoked from a seat standing in an older worktree, once refused every batch
 * that changed a plan source. `gitInTemp` per `src/__tests__/tempGitRepo.ts` builds every fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LAP_PLAN_SOURCES } from "../../../../../cli/commands/github/lapPlanSources.js";
import { planSourcesDiffering } from "../../../../../cli/commands/github/lapPreflightReads.js";
import { unwrap } from "../../../../../lib/result.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../../tempGitRepo.js";

const CI = ".github/workflows/ci.yml";
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory under the per-file temp root, removed after the test. */
function freshDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** Write every plan source under `root`, `ci.yml` carrying `ci` and every other one a fixed body. */
function writePlanSources({ root, ci }: { root: string; ci: string }): void {
  for (const relative of LAP_PLAN_SOURCES) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), relative === CI ? ci : "same\n");
  }
}

/** A checkout on `main` holding every plan source, and a head commit that changes only `ci.yml`, left unchecked-out. */
function checkoutBehindHead(): { invokedIn: string; headSha: string } {
  const invokedIn = freshDir({ prefix: "lap-invoked-" });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: invokedIn });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: invokedIn });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: invokedIn });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: invokedIn });
  writePlanSources({ ci: "old\n", root: invokedIn });
  gitInTemp({ args: ["add", "-A"], cwd: invokedIn });
  gitInTemp({ args: ["commit", "-q", "-m", "base"], cwd: invokedIn });
  gitInTemp({ args: ["checkout", "-q", "-b", "member"], cwd: invokedIn });
  writeFileSync(join(invokedIn, CI), "new\n");
  gitInTemp({ args: ["commit", "-q", "-am", "member changes ci.yml"], cwd: invokedIn });
  const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: invokedIn });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: invokedIn });
  return { headSha, invokedIn };
}

describe("planSourcesDiffering over real git", REAL_GIT_SUITE, () => {
  it("compares the CLI's own tree with the head, so a runner carrying the head's CI change matches from any directory", () => {
    const { invokedIn, headSha } = checkoutBehindHead();
    const cliTree = freshDir({ prefix: "lap-cli-" });
    writePlanSources({ ci: "new\n", root: cliTree });
    expect(unwrap(planSourcesDiffering({ cliTree, cwd: invokedIn, headSha }))).toEqual([]);
  });

  it("names ci.yml when the CLI's own tree is the one behind the head, whatever the invoking checkout holds", () => {
    const { invokedIn, headSha } = checkoutBehindHead();
    expect(unwrap(planSourcesDiffering({ cliTree: invokedIn, cwd: invokedIn, headSha }))).toEqual([CI]);
    const cliTree = freshDir({ prefix: "lap-cli-" });
    writePlanSources({ ci: "old\n", root: cliTree });
    writeFileSync(join(invokedIn, CI), "new\n");
    expect(unwrap(planSourcesDiffering({ cliTree, cwd: invokedIn, headSha }))).toEqual([CI]);
  });
});
