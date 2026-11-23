/**
 * A root with no mirror yet resolves its hooks through the seed, even when its first build is killed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  envFor,
  fixture,
  fixtureDirs,
  hookExecuteBits,
  mirrorRoot,
  runOnce,
  SCRIPT,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

/**
 * An `rsync` on PATH that never returns, so the build phase can be caught in the act.
 *
 * The script picks `rsync` over `cp -R` with `command -v`, so a shim on PATH makes this deterministic on a
 * machine with rsync and on one without alike. A real program the script really execs — a seam, not a mock.
 *
 * @returns the directory to prepend to PATH
 */
function hangingRsyncDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-rsync-hang-"));
  writeFileSync(join(dir, "rsync"), "#!/bin/sh\nsleep 600\n", { mode: 0o755 });
  return dir;
}

describe("a seat spawned into a root with no mirror yet", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * MEASURED, and the reason this case exists rather than a comment about timeouts: five
   * SessionStart runs of this script were killed by the host at 60053-60128 ms against the `"timeout": 60`
   * its `hooks.json` entry declares — grep `"hook_cancelled"` across the seats' own transcripts under
   * `~/.claude/projects`. Two of those roots were left with no `current` at all, and their seats then logged
   * `exitCode 127 … current/scripts/hook.sh: No such file or directory` on SessionStart, PreToolUse and
   * Stop — every guard off, non-blocking, for the life of the session.
   *
   * The kill is made deterministic by hanging the BUILD rather than by racing a timer: whatever the host
   * does to this process, what the seat needs is a `current` that already resolves.
   */
  it("resolves its own scripts/hook.sh even when the build is killed before the flip", () => {
    const { root, data, bin } = fixture();
    const shim = hangingRsyncDir();
    fixtureDirs.push(shim);
    const mirror = mirrorRoot({ data, root });
    const env = envFor({ bin, data, root });
    // Background the script, wait for it to reach its build, then kill the tree the way the host does.
    // `pkill -P` reaches the hanging rsync, which is a direct child, so no `sleep 600` outlives the test.
    const launcher = [
      `export PATH="${shim}:$PATH"`,
      `bash "$0" >/dev/null 2>&1 &`,
      `pid=$!`,
      `for _ in $(seq 1 150); do [ -e "${join(mirror, "current")}" ] && break; sleep 0.1; done`,
      `pkill -P "$pid" 2>/dev/null || true`,
      `kill -9 "$pid" 2>/dev/null || true`,
      `wait "$pid" 2>/dev/null || true`,
    ].join("\n");
    execFileSync("bash", ["-c", launcher, SCRIPT], { encoding: "utf8", env });

    // The falsifiable half: `.last-sync` is written in the same breath as the flip, so its ABSENCE is the
    // positive proof that this run never reached one. Without it the case would pass just as well on a
    // build that simply finished, which proves nothing about a killed one.
    expect(existsSync(join(mirror, ".last-sync"))).toBe(false);
    expect(hookExecuteBits({ path: join(mirror, "current", "scripts", "hook.sh") })).toBe("111");
    // And the source really does carry it, so the assertion above cannot pass on a fixture that stopped.
    expect(hookExecuteBits({ path: join(root, "scripts", "hook.sh") })).toBe("111");
  });

  it("replaces that seed with a real slot as soon as one build completes", () => {
    const { root, data, bin } = fixture();
    const mirror = mirrorRoot({ data, root });
    runOnce({ bin, data, root });
    // The seed is a staging state, never the resting one: a finished build leaves `current` inside the
    // mirror, which is what makes the tree survive the plugin root being pruned out from under a session.
    expect(readlinkSync(join(mirror, "current"))).toBe(".slot-a");
    expect(hookExecuteBits({ path: join(mirror, "current", "scripts", "hook.sh") })).toBe("111");
  });
});
