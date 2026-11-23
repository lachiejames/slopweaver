/**
 * The witness that the rebuildable caches stay out of the home: every shipped surface that once wrote one of
 * them under `$SLOPWEAVER_HOME` — the doctor's exec-store probe, `worktree unshare`, `checkout console`, `codex
 * plugin-sync`, and `scripts/docs-site.sh`'s run records — is run for real, as the shipped binary, over an EMPTY
 * home with its own cache root, and the home ends holding none of the moved entries.
 *
 * Silence alone proves nothing (`.claude/rules/testing.md`), so the run carries two positive witnesses: the
 * doctor's own JSON names the cache root this run passed, and `codex plugin-sync --log` — which writes its outcome
 * line on every run, a skip included — leaves `sync.log` under the CACHE root. Before the move that same run
 * made `codex-plugin/` under the home, which is what the last assertion refuses.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");

/** Every entry this move took out of the home, by the name it had there. */
const MOVED = ["exec-store", "codex-plugin", "docs-site", "console", "desktop"] as const;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A machine of its own: a user home, an empty state home under it, a cache root beside it and a git checkout. */
function machine(): { env: NodeJS.ProcessEnv; home: string; cache: string; checkout: string } {
  const user = mkdtempSync(join(tmpdir(), "sw-cache-witness-"));
  made.push(user);
  const home = join(user, "state");
  mkdirSync(home);
  const checkout = join(user, "checkout");
  mkdirSync(checkout);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: checkout });
  const cache = join(user, "cache");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: user, SLOPWEAVER_CACHE_HOME: cache, SLOPWEAVER_HOME: home };
  delete env["XDG_CACHE_HOME"];
  return { cache, checkout, env, home };
}

/** Run one command to completion, answering its exit code and stdout. */
function run({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): {
  code: number | null;
  stdout: string;
} {
  const done = spawnSync(command, [...args], { cwd, encoding: "utf8", env, timeout: REAL_GIT_TIMEOUT_MS * 6 });
  return { code: done.status, stdout: done.stdout };
}

describe("no consumer recreates a moved cache under the home", { timeout: REAL_GIT_TIMEOUT_MS * 30 }, () => {
  it("runs every surface that once wrote one, and the home holds none of them", () => {
    expect(MOVED.length).toBeGreaterThan(0);
    const { env, home, cache, checkout } = machine();

    const doctor = run({ args: ["doctor", "--json"], command: BIN, cwd: checkout, env });
    expect(doctor.code).toBe(0);
    expect((JSON.parse(doctor.stdout) as { cacheRoot: string }).cacheRoot).toBe(cache);

    const ran = [
      run({ args: ["worktree", "unshare", "--report"], command: BIN, cwd: checkout, env }),
      run({ args: ["checkout", "console", "--json"], command: BIN, cwd: checkout, env }),
      run({ args: ["codex", "plugin-sync", "--decide"], command: BIN, cwd: checkout, env }),
      run({ args: ["codex", "plugin-sync", "--log"], command: BIN, cwd: checkout, env }),
      run({ args: [SCRIPT, "--status"], command: "bash", cwd: repoRoot, env }),
    ];
    // Each one ran to an exit of its own rather than being killed by the timeout.
    expect(ran.map((one) => one.code === null)).toEqual([false, false, false, false, false]);
    expect(readFileSync(join(cache, "codex-plugin", "sync.log"), "utf8")).toContain("codex plugin-sync: skipped");

    expect(MOVED.filter((name) => existsSync(join(home, name)))).toEqual([]);
  });
});
