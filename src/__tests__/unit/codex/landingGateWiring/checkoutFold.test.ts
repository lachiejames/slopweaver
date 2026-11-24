/**
 * `readLocalCodexLoop` folds the pass records of every checkout that holds a pull request's head, proved
 * against two real worktrees of one repository.
 *
 * Zero mocks: every edge is a plain function the harness writes, per `.claude/rules/testing.md`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { commitTreeFingerprint, resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryFallbackRegisterPort } from "../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../landingRegistersFixture.js";
import { gitInTemp } from "../../../tempGitRepo.js";
import { BASE_SHA, homes, REAL_GIT, REPO, scratchHome, unwrapFingerprint } from "./harness.js";

/**
 * The shape the finding is actually about: one session plans and implements in its own worktree, another is
 * dispatched to land the pull request from somewhere else entirely.
 *
 * Before this change the second session's read failed the branch check by construction, reported
 * `codex-loop-incomplete` over a loop that was complete, and left `--acknowledge codex-loop-incomplete` as
 * the only way through — a floor acknowledged every time. The evidence was on disk the whole time; nothing
 * looked at it.
 */
describe("readLocalCodexLoop folds every checkout that holds the pull request's head", REAL_GIT, () => {
  /** A one-commit repository on `feature`, plus a second worktree of it sharing the same objects. */
  function twoCheckouts({ label }: { label: string }): { authoring: string; landing: string; headSha: string } {
    const dir = mkdtempSync(join(tmpdir(), `slopweaver-fleet-${label}-`));
    homes.push(dir);
    const authoring = join(dir, "authoring");
    mkdirSync(authoring, { recursive: true });
    const steps: readonly (readonly string[])[] = [
      ["init", "--initial-branch=feature"],
      ["config", "user.email", "dev@example.invalid"],
      ["config", "user.name", "Dev"],
      ["remote", "add", "origin", `git@github.com:${REPO}.git`],
    ];
    for (const args of steps) {
      gitInTemp({ args, cwd: authoring });
    }
    writeFileSync(join(authoring, "a.txt"), "one\n");
    gitInTemp({ args: ["add", "-A"], cwd: authoring });
    gitInTemp({ args: ["commit", "-m", "the work"], cwd: authoring });
    const landing = join(dir, "landing");
    // A real worktree, which is the fleet's real shape: its own root and its own branch, the same objects.
    gitInTemp({ args: ["worktree", "add", "-b", "somewhere-else", landing], cwd: authoring });
    return { authoring, headSha: unwrapFingerprint({ cwd: authoring }).headSha, landing };
  }

  /** Write one pass record where a real pass would have left it — an `artifact.md` beside a `record.json`. */
  function writeRecord({
    home,
    id,
    mode,
    repoRoot,
    tree,
    verdict,
  }: {
    home: string;
    id: string;
    mode: "plan" | "review";
    repoRoot: string;
    tree: { branch: string; dirtyBytes: number; fingerprint: string; headSha: string; treeSha: string };
    verdict: string;
  }): void {
    const run = join(stateHomePaths({ home }).orchestration, id);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "artifact.md"), `# ${id}\n`);
    const scope =
      mode === "plan" ? { mode, pass: "p1" } : { mode, pass: "r1", property: { id: "r1-01", statement: "s" } };
    writeFileSync(
      join(run, "record.json"),
      JSON.stringify({
        artifactId: id,
        attempts: [],
        bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
        createdAtIso: "2026-09-16T01:00:00.000Z",
        observedElapsedMs: 10,
        outcome: {
          answer: { blockers: [], bodyMarkdown: "", counterexample: "", evidence: "e", summary: "s", verdict },
          kind: "answered",
          rawFinalResponse: "{}",
        },
        repoRoot,
        requestedApprovalPolicy: "never",
        requestedModel: "m",
        requestedNetworkAccess: true,
        requestedReasoningEffort: "xhigh",
        requestedSandboxMode: "workspace-write",
        requestedWebSearch: true,
        requestedWritableRoots: [],
        schemaVersion: 1,
        scope,
        tree,
      }),
    );
  }

  it("clears the floor when the plan and the review were recorded in DIFFERENT checkouts", async () => {
    const home = scratchHome({ label: "fleet" });
    const { authoring, landing, headSha } = twoCheckouts({ label: "fleet" });
    const head = { baseSha: BASE_SHA, branch: "feature", headSha, repository: REPO };
    const atHead = unwrap(commitTreeFingerprint({ commit: headSha, cwd: authoring }));
    // The plan read the tree BEFORE the work, so it is STALE against the head — which is what the plan half
    // requires, and the one thing on the record saying the work came after it.
    const before = treeFingerprint({ dirtyPatch: "", headSha, treeSha: `${"9".repeat(38)}ab` });
    writeRecord({
      home,
      id: "plan-in-authoring",
      mode: "plan",
      repoRoot: unwrap(resolveRepoRoot({ cwd: authoring })),
      tree: {
        branch: "feature",
        dirtyBytes: 0,
        fingerprint: before.digest,
        headSha,
        treeSha: before.treeSha,
      },
      verdict: "READY",
    });
    // The review read the code being landed, so it is CURRENT against the head — recorded in the OTHER
    // checkout, which is precisely what the old reader could not see.
    writeRecord({
      home,
      id: "review-in-landing",
      mode: "review",
      repoRoot: unwrap(resolveRepoRoot({ cwd: landing })),
      tree: {
        branch: "feature",
        dirtyBytes: 0,
        fingerprint: atHead.digest,
        headSha,
        treeSha: atHead.treeSha,
      },
      verdict: "CLEAN",
    });

    // Read from the LANDING checkout, which sits on `somewhere-else` — the dispatched session's position.
    const read = await readLocalCodexLoop({
      cwd: landing,
      fallbackPort: memoryFallbackRegisterPort(),
      head,
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("read");
    expect(read.kind === "read" ? read.evidence.failures : ["the read refused"]).toEqual([]);
  });

  /**
   * A worktree that holds the head but has nothing on the branch cannot change the verdict, so it is never asked
   * (`src/codex/branchEvidenceRoots.ts`): the floor still clears off the authoring checkout's evidence, and the
   * roots the read reports are the presser's own and the one the evidence names.
   */
  it("judges the checkouts with evidence on the branch, and skips a bystander that holds the head", async () => {
    const home = scratchHome({ label: "fleet-bystander" });
    const { authoring, landing, headSha } = twoCheckouts({ label: "fleet-bystander" });
    const bystander = join(authoring, "..", "bystander");
    gitInTemp({ args: ["worktree", "add", "-b", "unrelated", bystander], cwd: authoring });
    const atHead = unwrap(commitTreeFingerprint({ commit: headSha, cwd: authoring }));
    const before = treeFingerprint({ dirtyPatch: "", headSha, treeSha: `${"9".repeat(38)}ab` });
    const authoringRoot = unwrap(resolveRepoRoot({ cwd: authoring }));
    const atTree = { dirtyBytes: 0, fingerprint: atHead.digest, headSha, treeSha: atHead.treeSha };
    writeRecord({
      home,
      id: "plan-in-authoring",
      mode: "plan",
      repoRoot: authoringRoot,
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: before.digest, headSha, treeSha: before.treeSha },
      verdict: "READY",
    });
    writeRecord({
      home,
      id: "review-in-authoring",
      mode: "review",
      repoRoot: authoringRoot,
      tree: { branch: "feature", ...atTree },
      verdict: "CLEAN",
    });
    // A pass on ANOTHER branch, so the bystander is a candidate the old read asked and this one does not.
    writeRecord({
      home,
      id: "review-in-bystander",
      mode: "review",
      repoRoot: unwrap(resolveRepoRoot({ cwd: bystander })),
      tree: { branch: "unrelated", ...atTree },
      verdict: "BROKEN",
    });

    const read = await readLocalCodexLoop({
      cwd: landing,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: BASE_SHA, branch: "feature", headSha, repository: REPO },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });
    if (read.kind !== "read") {
      throw new Error(`the read refused: ${read.reason}`);
    }

    expect(read.evidence.failures).toEqual([]);
    expect(read.evidence.roots).toEqual([unwrap(resolveRepoRoot({ cwd: landing })), authoringRoot]);
  });

  /**
   * The witness fires in the other direction, so the case above is not passing for want of a floor: drop the
   * review and the same read refuses, naming the half that is missing rather than the checkout it is in.
   */
  it("still refuses when a half is genuinely missing, wherever the presser is standing", async () => {
    const home = scratchHome({ label: "fleet-half" });
    const { authoring, landing, headSha } = twoCheckouts({ label: "fleet-half" });
    const before = treeFingerprint({ dirtyPatch: "", headSha, treeSha: `${"9".repeat(38)}ab` });
    writeRecord({
      home,
      id: "plan-only",
      mode: "plan",
      repoRoot: unwrap(resolveRepoRoot({ cwd: authoring })),
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: before.digest, headSha, treeSha: before.treeSha },
      verdict: "READY",
    });

    const read = await readLocalCodexLoop({
      cwd: landing,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: BASE_SHA, branch: "feature", headSha, repository: REPO },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("read");
    expect(read.kind === "read" ? read.evidence.failures : []).toEqual([
      "no general review pass has run on this branch — the diff has never been read by the second brain",
    ]);
  });
});
