/**
 * `github merge --admin`'s post-merge docs-budget probe, against real git: a fetch that fails reads as
 * not-evaluated with the remote named, and the private ref it would have used is never left behind.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionProbePostMergeDocsBudget } from "../../../../../cli/commands/github/mergeAdminProbe.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository on `main` with one commit and a remote whose path does not exist. */
function repoWithDeadRemote(): string {
  const repo = mkdtempSync(join(tmpdir(), "sw-probe-"));
  fixtures.push(repo);
  gitInTemp({ args: ["init", "--initial-branch", "main"], cwd: repo });
  gitInTemp({ args: ["config", "user.email", "t@example.com"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "t"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  writeFileSync(join(repo, "base.txt"), "base", "utf8");
  gitInTemp({ args: ["add", "."], cwd: repo });
  gitInTemp({ args: ["commit", "-m", "base"], cwd: repo });
  gitInTemp({ args: ["remote", "add", "gone", join(repo, "no-such-remote")], cwd: repo });
  return repo;
}

describe("productionProbePostMergeDocsBudget", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads a failed fetch as not-evaluated, naming the remote and branch", () => {
    const repo = repoWithDeadRemote();

    const sweep = productionProbePostMergeDocsBudget({ baseBranch: "main", cwd: repo, remote: "gone" });

    expect(sweep.kind).toBe("not-evaluated");
    expect(sweep).toMatchObject({
      reason: expect.stringContaining("could not fetch gone/main to probe it post-merge: "),
    });
  });

  it("leaves no private fetch ref behind", () => {
    const repo = repoWithDeadRemote();

    productionProbePostMergeDocsBudget({ baseBranch: "main", cwd: repo, remote: "gone" });

    expect(gitInTemp({ args: ["for-each-ref", "refs/slopweaver/"], cwd: repo })).toBe("");
  });
});
