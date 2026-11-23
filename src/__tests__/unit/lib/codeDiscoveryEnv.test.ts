/**
 * The code's own checkout must resolve under an inherited discovery ceiling, the run-due repo fallback's second
 * anchor: a `GIT_CEILING_DIRECTORIES` set below the checkout root makes `rev-parse` refuse to climb to it.
 *
 * Real git, per `.claude/rules/testing.md`'s fixture allowance: the subject IS git's own discovery rule, and a
 * fake would only prove that this file agrees with itself.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { codeDiscoveryEnv, gitEnv, repoRootFromDirectory } from "../../../lib/gitRepo.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository with a nested `src/lib`, the shape a module inside a checkout is loaded from. */
function codeCheckout(): { root: string; lib: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "slopweaver-cde-")));
  dirs.push(root);
  gitInTemp({ args: ["init", "--initial-branch=main"], cwd: root });
  const lib = join(root, "src", "lib");
  mkdirSync(lib, { recursive: true });
  return { lib, root };
}

describe("codeDiscoveryEnv", () => {
  it("drops the discovery ceiling and keeps every other variable", () => {
    const env = codeDiscoveryEnv({ env: { GIT_CEILING_DIRECTORIES: "/x/src", PATH: "/bin" } });

    expect(env).toEqual({ PATH: "/bin" });
  });

  it("is a copy, leaving the environment it was given untouched", () => {
    const given = { GIT_CEILING_DIRECTORIES: "/x/src" };
    codeDiscoveryEnv({ env: given });

    expect(given).toEqual({ GIT_CEILING_DIRECTORIES: "/x/src" });
  });

  it("resolves the code's checkout through a ceiling set below its root, which gitEnv alone refuses", REAL_GIT, () => {
    const { lib, root } = codeCheckout();
    const ceiled = { ...gitEnv(), GIT_CEILING_DIRECTORIES: join(root, "src") };

    expect(() => repoRootFromDirectory({ dir: lib, env: ceiled })).toThrow("not a git repository");
    expect(repoRootFromDirectory({ dir: lib, env: codeDiscoveryEnv({ env: ceiled }) })).toBe(root);
  });
});
