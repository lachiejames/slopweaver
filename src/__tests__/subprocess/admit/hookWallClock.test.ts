/**
 * The PreToolUse hook's wall clock, pinned on the path that was measured slow.
 *
 * MEASURED: `slopweaver perf` read 101 `PreToolUse:Bash` calls that spent the whole
 * 15s budget and ran with no verdict. Traced over the real registry on a supervisor payload whose cwd was a
 * linked worktree, main-checkout-guard was the check that scaled worst — 145–302 ms idle, 480–1941 ms under
 * load 17–28 — because `src/admit/mainWorktree.ts` forked `git rev-parse` six times per call with no timeout.
 * The topology is now read from disk, and this file is what keeps it that way.
 *
 * The first block holds the disk read EQUAL to `git rev-parse` on a real `git worktree add` fixture, since the
 * read replaced git's own answer and a divergence would move a protection.
 *
 * The second block is the wall-clock pin, on the SHIPPED `scripts/pretooluse.sh`: a `Bash` call whose cwd is
 * a linked worktree, with a `git` first on PATH that sleeps a minute. Any check on that path that forks git
 * again hangs inside it, the dispatch is killed at the budget, and the call is refused — so the verdict, the
 * silence of the kill line and the ceiling all redden together. The ceiling is the narrowed budget itself:
 * finishing under it is the whole property.
 */
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isMainWorktree } from "../../../admit/mainWorktree.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The `session_id` the timed payload carries, and the one the owner's profile is marked delivered for. */
const SESSION = "wall-clock-session";

/** The narrowed budget the shim runs under, in seconds — and the wall-clock ceiling a verdict must beat. */
const BUDGET_SECONDS = 10;

/** Per-test budget: the shim's own budget plus a tsx boot under lane contention. */
const CASE_TIMEOUT_MS = 90_000;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway directory, removed after the test that minted it.
 *
 * @param prefix names the fixture in the temp root
 * @returns its canonical path
 */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/**
 * A real repository with one real linked worktree.
 *
 * @returns the main worktree, the linked one, and a subdirectory of the main one
 */
function realRepoWithWorktree(): { main: string; linked: string; subdir: string } {
  const main = tempDir({ prefix: "sw-wallclock-main-" });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  gitInTemp({ args: ["commit", "--allow-empty", "-q", "-m", "root"], cwd: main });
  const linked = join(tempDir({ prefix: "sw-wallclock-linked-" }), "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  const subdir = join(main, "packages", "x");
  mkdirSync(subdir, { recursive: true });
  return { linked, main, subdir };
}

/**
 * What git itself says: whether `--git-dir` and `--git-common-dir` resolve to the same directory.
 *
 * @param cwd the directory git is asked about
 * @returns git's own main-worktree answer
 */
function gitSaysMain({ cwd }: { cwd: string }): boolean {
  const gitDir = realpathSync(resolve(cwd, gitInTemp({ args: ["rev-parse", "--git-dir"], cwd })));
  const commonDir = realpathSync(resolve(cwd, gitInTemp({ args: ["rev-parse", "--git-common-dir"], cwd })));
  return gitDir === commonDir;
}

describe("the disk read of worktree topology, against git's own answer", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("agrees with git rev-parse in a main worktree, a subdirectory of it, and a linked worktree", () => {
    const { linked, main, subdir } = realRepoWithWorktree();
    expect([gitSaysMain({ cwd: main }), gitSaysMain({ cwd: subdir }), gitSaysMain({ cwd: linked })]).toEqual([
      true,
      true,
      false,
    ]);
    expect([isMainWorktree({ cwd: main }), isMainWorktree({ cwd: subdir }), isMainWorktree({ cwd: linked })]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("agrees with git rev-parse that a .git directory with no HEAD is walked past", () => {
    const { linked } = realRepoWithWorktree();
    const nested = join(linked, "vendor", "x");
    mkdirSync(join(nested, ".git"), { recursive: true });
    expect(gitSaysMain({ cwd: nested })).toBe(false);
    expect(isMainWorktree({ cwd: nested })).toBe(false);
  });
});

/**
 * A directory holding one executable `git` that never answers in time.
 *
 * @returns the directory, to put first on PATH
 */
function hangingGitDir(): string {
  const dir = tempDir({ prefix: "sw-wallclock-bin-" });
  const git = join(dir, "git");
  writeFileSync(git, "#!/bin/sh\nsleep 60\n", "utf8");
  chmodSync(git, 0o755);
  return dir;
}

/**
 * Run the shipped `PreToolUse` shim over one `Bash` payload.
 *
 * @param cwd the payload's working directory, which the main-checkout guards judge
 * @param pathPrefix a directory put in front of PATH
 * @returns the exit status, stderr, and how long the call was held
 */
async function runShim({
  cwd,
  pathPrefix,
}: {
  cwd: string;
  pathPrefix: string;
}): Promise<{ status: number | null; stderr: string; elapsedMs: number }> {
  const home = tempDir({ prefix: "sw-wallclock-home-" });
  // The owner's profile is delivered to this session, so `profile-held` does not refuse the call this case times.
  seedProfileDelivered({ home, sessionId: SESSION });
  const startedMs = Date.now();
  const child = spawn(join(repoRoot, "scripts", "pretooluse.sh"), {
    cwd,
    // An empty config dir, so the shim runs THIS tree's dispatcher rather than the installed plugin's.
    env: {
      CLAUDE_CONFIG_DIR: tempDir({ prefix: "sw-wallclock-config-" }),
      HOME: process.env["HOME"]!,
      PATH: `${pathPrefix}:${process.env["PATH"]!}`,
      SLOPWEAVER_HOME: home,
      SLOPWEAVER_HOOK_BUDGET_SECONDS: String(BUDGET_SECONDS),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      session_id: SESSION,
      tool_input: { command: "echo hi" },
      tool_name: "Bash",
    }),
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((settle) => {
    child.on("close", (code) => {
      settle(code);
    });
  });
  return { elapsedMs: Date.now() - startedMs, status, stderr };
}

describe("the PreToolUse shim's wall clock on the measured slow path", { timeout: CASE_TIMEOUT_MS }, () => {
  it("decides a Bash call from a linked worktree inside its budget, with a git that never answers", async () => {
    const { linked } = realRepoWithWorktree();
    const run = await runShim({ cwd: linked, pathPrefix: hangingGitDir() });

    expect(run.stderr).not.toContain("killed after");
    expect(run.stderr).not.toContain("no gate reached a verdict");
    expect(run.status).toBe(0);
    expect(run.elapsedMs).toBeLessThan(BUDGET_SECONDS * 1000);
  });
});
