/**
 * The SCAN never runs somebody else's code, even though every command it issues is a read.
 *
 * A review pass reproduced the loss end-to-end: `status --porcelain` fires `post-index-change`, and
 * `core.fsmonitor` names a SECOND executable that `core.hooksPath` does not govern. The capture had carried
 * armour against both since an earlier pass; the scan — which issues the same two reads — had none, so a
 * repository configuring either got that code run over an index the capture had not protected yet. The
 * counterexample used a monitor running `git add`: staged-only content was overwritten by the SCAN, and the
 * capture then faithfully pushed the overwritten version and removed the tree.
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanWorktree } from "../../../worktree/pruneScan.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

describe("scanWorktree's reads", REAL_GIT_SUITE, () => {
  let dir = "";
  let fired = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scan-hooks-"));
    fired = join(dir, ".git", "MONITOR-RAN");
    gitInTemp({ cwd: dir, args: ["init", "-q", "-b", "main"] });
    writeFileSync(join(dir, "visible.txt"), "base\n");
    gitInTemp({ cwd: dir, args: ["add", "-A"] });
    gitInTemp({ cwd: dir, args: ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm", "base"] });
    // The executable git runs on its OWN initiative. It only leaves a marker; the real counterexample ran
    // `git add`, which is the same reachability with a destructive body.
    const monitor = join(dir, ".git", "monitor.sh");
    writeFileSync(monitor, `#!/bin/sh\ntouch ${JSON.stringify(fired)}\nexit 1\n`);
    chmodSync(monitor, 0o755);
    gitInTemp({ cwd: dir, args: ["config", "core.fsmonitor", monitor] });
    // Dirt, so the scan actually reaches its working-tree reads rather than short-circuiting.
    writeFileSync(join(dir, "visible.txt"), "edited\n");
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("does not run a repository's core.fsmonitor executable", () => {
    const facts = scanWorktree({
      liveRefs: [],
      mainCheckout: "/nowhere",
      openPullRequests: [],
      repoRoot: dir,
      runsDir: join(dir, "no-runs"),
      trunk: "main",
      worktree: { branch: "main", path: dir },
    });

    // The falsifiable half: the scan DID read this tree, so the absence below is armour and not a no-op.
    expect(facts.dirtyCount).toBe(1);
    expect(existsSync(fired)).toBe(false);
  });
});
