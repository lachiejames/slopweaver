/**
 * Which checkout and branch a `codex` verb reports on when the caller named neither — against a real throwaway
 * repository, since what `git` answers for an unnamed branch is the behaviour under test.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexRepoRoot, repoDirOf, reportedBranch } from "../../../../../cli/commands/codex/repoScope.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh repository whose unborn branch is `work`. */
function repoOnWork(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-scope-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "work"], cwd: dir });
  return dir;
}

/** A directory that does not exist, so any `git` run in it fails. */
function missingDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-scope-missing-"));
  fixtureDirs.push(dir);
  return join(dir, "absent");
}

describe("repoDirOf", () => {
  it("names the --repo the caller passed", () => {
    expect(repoDirOf({ repo: "/some/checkout" })).toBe("/some/checkout");
  });

  it("stands where the verb was run when no --repo was named", () => {
    expect(repoDirOf({ repo: undefined })).toBe(process.cwd());
  });
});

describe("codexRepoRoot", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("resolves the named checkout's top-level directory", () => {
    const dir = repoOnWork();
    const root = codexRepoRoot({ repo: dir });
    expect(root.isOk()).toBe(true);
    expect(root._unsafeUnwrap()).toBe(realpathSync(dir));
  });

  it("refuses a --repo git cannot read, naming the git operation", () => {
    const root = codexRepoRoot({ repo: missingDir() });
    expect(root._unsafeUnwrapErr().operation).toBe("codex.resolveRepoRoot");
  });
});

describe("reportedBranch", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports the --branch the caller named, without asking git", () => {
    expect(reportedBranch({ branchFlag: "feature/x", repoRoot: missingDir() })).toBe("feature/x");
  });

  it("reports the branch the checkout has out when no --branch was named", () => {
    expect(reportedBranch({ branchFlag: undefined, repoRoot: repoOnWork() })).toBe("work");
  });

  it("reports no branch when none was named and git cannot read the checkout", () => {
    expect(reportedBranch({ branchFlag: undefined, repoRoot: missingDir() })).toBe(null);
  });
});
