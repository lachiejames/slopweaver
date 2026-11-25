/**
 * The snapshot-release regression this repo's own handover doc named directly: `frozen?.release()` used to
 * be a plain statement after the awaited pass, so any real failure — a timeout, a transport error — skipped
 * it and leaked the frozen worktree `freezeForPass` had just created. Reproduced here with a REAL temporary
 * git repository, so the assertion is "the pooled slot's lease came back", read off its marker on disk, not
 * "a fake's `release` was called".
 */

import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makePassBound } from "../../../codex/bounds.js";
import type { LockedCodexClient } from "../../../codex/client.js";
import { runPlanPass } from "../../../codex/orchestrate.js";
import { admitPass, admittedPass } from "../../../codex/passAdmission.js";
import { passProfile } from "../../../codex/profiles.js";
import type { DeadlineRuntime, ScheduledTask } from "../../../codex/runPass.js";
import { unwrap } from "../../../lib/result.js";
import { snapshotPoolRoot } from "../../../worktree/snapshotPoolPath.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** A repository with one committed file — enough for `freezeForPass` to have something to snapshot. */
function seededRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-orchestrate-src-"));
  const git = ({ args }: { args: readonly string[] }): string => gitInTemp({ args, cwd: dir });
  git({ args: ["init", "-q"] });
  git({ args: ["config", "user.email", "test@example.com"] });
  git({ args: ["config", "user.name", "Test"] });
  writeFileSync(join(dir, "tracked.txt"), "committed\n");
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "seed"] });
  return dir;
}

/**
 * Every snapshot-pool slot of a repository and the state marker in each, under the default pool parent (this
 * file's temp sandbox). A pass leases a slot rather than minting a worktree, so "released" means every marker
 * reads `state.free` — a leaked lease would read `state.busy.<pid>.<uuid>` with this live pid.
 */
function poolMarkers({ repoRoot }: { repoRoot: string }): readonly string[] {
  const poolRoot = snapshotPoolRoot({ commonGitDir: realpathSync(join(repoRoot, ".git")), poolParent: tmpdir() });
  return readdirSync(poolRoot)
    .filter((entry) => entry.startsWith("slot-"))
    .flatMap((slot) => readdirSync(join(poolRoot, slot)).filter((entry) => entry.startsWith("state.")));
}

/** How many worktrees git has registered against a repository, pool slots included. */
function worktreeCount({ repoRoot }: { repoRoot: string }): number {
  const listing = gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot });
  return listing.split("\n\n").filter((block) => block.trim().length > 0).length;
}

/** A clock/timer seam that is never actually consulted: the throw happens before the first turn starts. */
class InertRuntime implements DeadlineRuntime {
  nowMs(): number {
    return 0;
  }
  nowIso(): string {
    return new Date(0).toISOString();
  }
  schedule(): ScheduledTask {
    return { cancel: () => {} };
  }
}

/** A client whose thread never starts — the shape of a transport failure that predates the first turn. */
const THROWING_CLIENT: LockedCodexClient = {
  model: "gpt-5.6-sol",
  resumeThread: () => {
    throw new Error("sandbox rejected the working directory");
  },
  startThread: () => {
    throw new Error("sandbox rejected the working directory");
  },
};

describe(
  "runPlanPass — releases its frozen snapshot even when the pass throws",
  {
    timeout: REAL_GIT_TIMEOUT_MS,
  },
  () => {
    it("leaves no worktree registered after a thrown failure", async () => {
      const repoRoot = seededRepo();
      const orchestrationRoot = mkdtempSync(join(tmpdir(), "slopweaver-orchestrate-scratch-"));
      const profile = passProfile({ pass: "p1" });
      if (profile.mode !== "plan") {
        throw new Error("p1 must be a plan profile");
      }

      await expect(
        runPlanPass({
          // A real admission over an empty ledger: the only way to obtain the proof a pass requires.
          admitted: admittedPass({ admission: admitPass({ hatchOpen: false, key: undefined, records: [] }) })!,
          bound: unwrap(makePassBound({ boundSeconds: 240 })),
          client: THROWING_CLIENT,
          newId: () => "test-artifact",
          orchestrationRoot,
          profile,
          reclaimLedgerPath: join(orchestrationRoot, "never-written-ledger.jsonl"),
          repoRoot,
          runtime: new InertRuntime(),
          task: "prove the finally runs",
        }),
      ).rejects.toThrow("sandbox rejected the working directory");

      // The main checkout plus the one pooled slot the pass leased — kept for the next pass, lease returned.
      expect(worktreeCount({ repoRoot })).toBe(2);
      expect(poolMarkers({ repoRoot })).toEqual(["state.free"]);

      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(orchestrationRoot, { force: true, recursive: true });
    });
  },
);
