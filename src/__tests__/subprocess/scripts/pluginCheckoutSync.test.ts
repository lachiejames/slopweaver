/**
 * The SessionStart fast-forward, proven against real repositories rather than described.
 *
 * `scripts/plugin-checkout-sync.sh` is what makes "the owner's sessions are never stale" true without the owner
 * running anything, so its REFUSALS matter as much as its success: it moves a checkout only when moving one
 * is provably safe, and every other shape must leave the tree untouched and still exit 0, because a session
 * boot may never fail on it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stripGitEnv } from "../../../codex/gitRun.js";
import { statFlavourShimDir } from "../../statFlavourShim.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SCRIPT = new URL("../../../../scripts/plugin-checkout-sync.sh", import.meta.url).pathname;

/** An mtime no live holder could have — the fixed clock both the real and the shimmed stale cases use. */
const LONG_DEAD = new Date("2026-09-16T00:00:00Z");
const LONG_DEAD_EPOCH_SECONDS = Math.floor(LONG_DEAD.getTime() / 1000);

/**
 * Run the hook exactly as a session start does: as a plain subprocess, with the plugin root it would see.
 *
 * @param pluginRoot what the host would hand the hook as `PLUGIN_ROOT`
 * @param dataDir the persistent plugin-data dir the lock lives in
 * @returns the process exit status, which must always be 0
 */
function runHook({
  pluginRoot,
  dataDir,
  statFlavour,
}: {
  pluginRoot: string;
  dataDir: string;
  statFlavour?: "gnu" | "bsd";
}): number {
  const env: NodeJS.ProcessEnv = {
    ...stripGitEnv({ env: process.env }),
    PLUGIN_DATA: dataDir,
    PLUGIN_ROOT: pluginRoot,
  };
  if (statFlavour !== undefined) {
    const shim = statFlavourShimDir({ flavour: statFlavour, mtimeSeconds: LONG_DEAD_EPOCH_SECONDS });
    shimDirs.push(shim.dir);
    Object.assign(env, shim.env);
    env["PATH"] = `${shim.dir}:${env["PATH"]!}`;
  }
  execFileSync("bash", [SCRIPT], { encoding: "utf8", env, stdio: "pipe" });
  return 0;
}

// Every `stat` shim directory this file has minted, so `afterEach` can remove them.
const shimDirs: string[] = [];

afterEach(() => {
  for (const dir of shimDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Everything the hook said, which is the half that matters now: a run that decides not to update must not
 * be indistinguishable from a run that found nothing to do.
 *
 * @param pluginRoot what the host would hand the hook as `PLUGIN_ROOT`
 * @param dataDir the persistent plugin-data dir the lock lives in
 * @returns the hook's stderr, with stdout discarded
 */
function noiseOf({ pluginRoot, dataDir }: { pluginRoot: string; dataDir: string }): string {
  return execFileSync("bash", ["-c", `"$0" 2>&1 1>/dev/null`, SCRIPT], {
    encoding: "utf8",
    env: { ...stripGitEnv({ env: process.env }), PLUGIN_DATA: dataDir, PLUGIN_ROOT: pluginRoot },
  });
}

/** An upstream repository two commits ahead of a clone of it, both under the OS temp dir. */
function fixture({ commitsAhead }: { commitsAhead: number }): { upstream: string; consumer: string; data: string } {
  const base = mkdtempSync(join(tmpdir(), "sw-ff-"));
  const upstream = join(base, "upstream");
  const consumer = join(base, "consumer");
  mkdirSync(upstream, { recursive: true });
  gitInTemp({ args: ["init", "--quiet", "--initial-branch", "main"], cwd: upstream });
  gitInTemp({ args: ["config", "user.email", "t@t"], cwd: upstream });
  gitInTemp({ args: ["config", "user.name", "t"], cwd: upstream });
  gitInTemp({ args: ["commit", "--quiet", "--allow-empty", "-m", "base"], cwd: upstream });
  gitInTemp({ args: ["clone", "--quiet", upstream, consumer], cwd: base });
  gitInTemp({ args: ["config", "user.email", "t@t"], cwd: consumer });
  gitInTemp({ args: ["config", "user.name", "t"], cwd: consumer });
  for (let i = 0; i < commitsAhead; i += 1) {
    gitInTemp({ args: ["commit", "--quiet", "--allow-empty", "-m", `ahead-${String(i)}`], cwd: upstream });
  }
  return { consumer, data: join(base, "data"), upstream };
}

/** The commit a checkout is sitting on. */
function headOf({ cwd }: { cwd: string }): string {
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd });
}

describe("plugin-checkout-sync.sh", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("fast-forwards a clean checkout that is behind its upstream", () => {
    const { consumer, data, upstream } = fixture({ commitsAhead: 2 });
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(headOf({ cwd: upstream }));
  });

  it("follows a symlinked plugin root to the real checkout, which is how the owner loads it", () => {
    const { consumer, data, upstream } = fixture({ commitsAhead: 1 });
    const link = `${consumer}-link`;
    execFileSync("ln", ["-s", consumer, link], { encoding: "utf8" });
    expect(runHook({ dataDir: data, pluginRoot: link })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(headOf({ cwd: upstream }));
  });

  it("leaves a dirty tree exactly where it was", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    const before = headOf({ cwd: consumer });
    writeFileSync(join(consumer, "uncommitted.txt"), "work in progress\n");
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(before);
  });

  it("leaves a detached HEAD alone", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    gitInTemp({ args: ["checkout", "--quiet", "--detach"], cwd: consumer });
    const before = headOf({ cwd: consumer });
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(before);
  });

  it("leaves a branch that tracks nothing alone", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    gitInTemp({ args: ["branch", "--unset-upstream"], cwd: consumer });
    const before = headOf({ cwd: consumer });
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(before);
  });

  it("refuses a linked worktree — somebody else's branch is never ours to move", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    const linked = `${consumer}-wt`;
    gitInTemp({ args: ["worktree", "add", "--quiet", "-b", "feature", linked], cwd: consumer });
    const before = headOf({ cwd: linked });
    expect(runHook({ dataDir: data, pluginRoot: linked })).toBe(0);
    expect(headOf({ cwd: linked })).toBe(before);
  });

  it("refuses a diverged branch rather than merging or resetting it", () => {
    const { consumer, data, upstream } = fixture({ commitsAhead: 2 });
    gitInTemp({ args: ["commit", "--quiet", "--allow-empty", "-m", "local-only"], cwd: consumer });
    const before = headOf({ cwd: consumer });
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(before);
    expect(headOf({ cwd: upstream })).not.toBe(before);
  });

  it("says which way it went when it moves the checkout", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    expect(noiseOf({ dataDir: data, pluginRoot: consumer })).toContain("fast-forwarded");
  });

  it("names a diverged branch rather than leaving it behind in silence", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    gitInTemp({ args: ["commit", "--quiet", "--allow-empty", "-m", "local-only"], cwd: consumer });
    expect(noiseOf({ dataDir: data, pluginRoot: consumer })).toContain(
      "is 2 commit(s) behind origin/main and 1 ahead, so it will not fast-forward — it has diverged",
    );
  });

  // MEASURED: a concurrent `git status` holding `.git/index.lock` fails a fast-forwardable merge
  // with exit 1 and moves nothing — 5 of 200 merges against a `git status --porcelain` loop. A held lock is
  // that failure made deterministic: the branch is behind and not ahead, so it is NOT diverged.
  it("never calls a still-clean fast-forward diverged when a held index lock fails the merge", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    const before = headOf({ cwd: consumer });
    writeFileSync(join(consumer, ".git", "index.lock"), "");
    const noise = noiseOf({ dataDir: data, pluginRoot: consumer });
    expect(headOf({ cwd: consumer })).toBe(before);
    expect(noise).toContain(
      "is 2 commit(s) behind origin/main and still a clean fast-forward, but the merge failed 3 times — another git process may hold a lock",
    );
    expect(noise).not.toContain("diverged");
  });

  it("stays silent when a held ORIG_HEAD lock fails the merge of a checkout already current", () => {
    const { consumer, data } = fixture({ commitsAhead: 0 });
    writeFileSync(join(consumer, ".git", "ORIG_HEAD.lock"), "");
    expect(noiseOf({ dataDir: data, pluginRoot: consumer })).toBe("");
  });

  it("says nothing when the checkout was already current", () => {
    const { consumer, data } = fixture({ commitsAhead: 0 });
    expect(noiseOf({ dataDir: data, pluginRoot: consumer })).toBe("");
  });

  it("breaks a lock old enough to prove its holder died, under whichever stat this host really has", () => {
    const { consumer, data, upstream } = fixture({ commitsAhead: 2 });
    const lock = join(data, "checkout-sync.lock");
    mkdirSync(lock, { recursive: true });
    utimesSync(lock, LONG_DEAD, LONG_DEAD);
    // No shim here on purpose: this is the case that proves the mtime is really read off the filesystem on
    // the machine the suite is running on. The two shimmed cases below prove which FORM is asked, and that a
    // non-numeric answer is rejected — neither of which needs a real mtime.
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(headOf({ cwd: upstream }));
  });

  it.each(["gnu", "bsd"] as const)("reads a held lock's age under a %s stat rather than aborting on it", (flavour) => {
    const { consumer, data, upstream } = fixture({ commitsAhead: 2 });
    const lock = join(data, "checkout-sync.lock");
    mkdirSync(lock, { recursive: true });
    utimesSync(lock, LONG_DEAD, LONG_DEAD);
    // The stale break is the only branch that reads an mtime, so it is the branch a wrong `stat` form kills.
    // Under the gnu shim the old expression fed a `File: "..."` block to `$(( ))` and `set -u` aborted the
    // hook, which on this script means a checkout that silently never moves again.
    expect(runHook({ dataDir: data, pluginRoot: consumer, statFlavour: flavour })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(headOf({ cwd: upstream }));
  });

  it("leaves the checkout alone while another booting session holds a FRESH lock", () => {
    const { consumer, data } = fixture({ commitsAhead: 2 });
    mkdirSync(join(data, "checkout-sync.lock"), { recursive: true });
    const before = headOf({ cwd: consumer });
    expect(runHook({ dataDir: data, pluginRoot: consumer })).toBe(0);
    expect(headOf({ cwd: consumer })).toBe(before);
  });

  it("is a silent no-op for a cache install, which is a directory with no repository at all", () => {
    const base = mkdtempSync(join(tmpdir(), "sw-cache-"));
    const cacheInstall = join(base, "0.2.0");
    mkdirSync(cacheInstall, { recursive: true });
    expect(runHook({ dataDir: join(base, "data"), pluginRoot: cacheInstall })).toBe(0);
    rmSync(base, { force: true, recursive: true });
  });
});
