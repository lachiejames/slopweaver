/**
 * Every worktree unit file that drives real git runs under {@link REAL_GIT_SUITE}, and that suite retries a TIMEOUT
 * only. The first real-git case of a file absorbed a 20–40 second stall on a loaded lap while the rest of the file ran
 * in about a second, so a suite left on the lane's 20s default failed both runs of a loaded lap. The criterion is the call, not a list of files: {@link DRIVES_GIT} names what spawns git, and a new file
 * that forgets the suite fails here rather than on somebody's lap.
 *
 * One residue is stated, not closed. The retry tests only a message, so a test that THROWS vitest's whole timeout
 * text on its first attempt and passes on its second is retried into a pass. Only a function
 * condition could tell that apart, and vitest 4.1.12 drops one from a describe's options — `tempGitRepo.ts` has
 * the measurement.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** This directory, the family the suite governs. */
const FAMILY = fileURLToPath(new URL(".", import.meta.url));

/**
 * What spawns real git in a fixture repository: NAMING a fixture helper or the production `realGit` runner anywhere,
 * an aliased import included, or reaching `child_process` at all, however its calls are
 * spelled or aliased. No file in this directory imports `child_process` today, and a spawn that is not
 * git pays nothing for the suite. A git-spawning helper from elsewhere that the criterion does not name is its
 * stated blind spot.
 */
const DRIVES_GIT = /\b(?:gitInTemp|seedRepo|useSalvageRepos|realGit|child_process)\b/u;

/** Every unit test file under this directory that drives real git, relative to it. */
const realGitFiles = readdirSync(FAMILY, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".test.ts"))
  .filter((path) => DRIVES_GIT.test(readFileSync(join(FAMILY, path), "utf8")));

describe("the real-git worktree suites", () => {
  it("finds the family it guards", () => {
    expect(realGitFiles.length).toBeGreaterThan(0);
    expect(realGitFiles).toContain("reclaimTrash.test.ts");
  });

  it("counts any child_process import, the production runner and an aliased helper as driving git", () => {
    expect(DRIVES_GIT.test(`import { execFileSync as run } from "node:child_process";`)).toBe(true);
    expect(DRIVES_GIT.test(`import { spawnSync } from "child_process";`)).toBe(true);
    expect(DRIVES_GIT.test("readIgnoredWork({ git: realGit, path })")).toBe(true);
    expect(DRIVES_GIT.test(`import { gitInTemp as runGit } from "../../tempGitRepo.js";`)).toBe(true);
    expect(DRIVES_GIT.test(`import { mkdtempSync } from "node:fs";`)).toBe(false);
    expect(DRIVES_GIT.test("stagedSymlinks({ staged })")).toBe(false);
  });

  it("runs every file that drives real git under REAL_GIT_SUITE", () => {
    expect(realGitFiles.filter((path) => !readFileSync(join(FAMILY, path), "utf8").includes("REAL_GIT_SUITE"))).toEqual(
      [],
    );
  });

  /** Vitest 4.1's `makeTimeoutError` text, verbatim, for a test and for a hook. */
  const timedOut = ({ kind, ms }: { kind: "test" | "hook"; ms: number }): string =>
    `${kind === "test" ? "Test" : "Hook"} timed out in ${String(ms)}ms.\nIf this is a long-running ${kind}, pass a ` +
    `timeout value as the last argument or configure it globally with "${kind}Timeout".`;

  it("retries a test or hook that timed out at the suite's budget, and nothing else", () => {
    const { condition } = REAL_GIT_SUITE.retry;
    expect(REAL_GIT_SUITE.timeout).toBe(REAL_GIT_TIMEOUT_MS);
    expect(REAL_GIT_SUITE.retry.count).toBe(1);
    expect(condition.test(timedOut({ kind: "test", ms: REAL_GIT_TIMEOUT_MS }))).toBe(true);
    expect(condition.test(timedOut({ kind: "hook", ms: REAL_GIT_TIMEOUT_MS }))).toBe(true);
    expect(condition.test(timedOut({ kind: "test", ms: 20_000 }))).toBe(false);
    expect(condition.test("expected 'kept' to be 'removed'")).toBe(false);
  });

  it("does not retry an assertion whose message merely quotes the timeout", () => {
    const { condition } = REAL_GIT_SUITE.retry;
    expect(condition.test(`Test timed out in ${String(REAL_GIT_TIMEOUT_MS)}ms`)).toBe(false);
    expect(condition.test(`before: ${timedOut({ kind: "test", ms: REAL_GIT_TIMEOUT_MS })}`)).toBe(false);
  });

  it("is a RegExp, the one condition shape vitest keeps on a describe's options", () => {
    expect(REAL_GIT_SUITE.retry.condition).toBeInstanceOf(RegExp);
  });
});
