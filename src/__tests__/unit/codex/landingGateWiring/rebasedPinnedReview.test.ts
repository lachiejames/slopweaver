/**
 * A Codex review pinned to a full base SHA carries across a rebase that leaves its patch byte-identical, read
 * through the real landing floor (`readLocalCodexLoop`) over a real repository.
 *
 * The defect: the carry re-diffed the rebased head against the review's OWN base ref, and a pinned base is the
 * old commit, so the diff folded in every commit main gained since and never matched. Pull requests that changed
 * no line of their own diff were refused `codex-loop-incomplete` at the lap. The pull request's current base is
 * what the landing floor now also diffs against (`src/codex/diffCarry.ts`).
 *
 * This is the wiring proof: a pure case handing `freshnessOf` a landing-base diff cannot catch the floor forgetting
 * to take one. Zero mocks: real git, real pass-record files, the in-memory ports the harness already uses.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { commitDiffSha256 } from "../../../../codex/diffsNow.js";
import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { commitTreeFingerprint, resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import type { LocalCodexLoopRead } from "../../../../codex/landingGateTypes.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryFallbackRegisterPort } from "../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../landingRegistersFixture.js";
import { gitInTemp } from "../../../tempGitRepo.js";
import { homes, REAL_GIT, REPO, scratchHome } from "./harness.js";

/** The full object name `rev` resolves to in `cwd`. */
function revParse({ cwd, rev }: { cwd: string; rev: string }): string {
  return gitInTemp({ args: ["rev-parse", rev], cwd }).trim();
}

/** Commit everything in the working tree. */
function commitAll({ cwd, message }: { cwd: string; message: string }): void {
  gitInTemp({ args: ["add", "-A"], cwd });
  gitInTemp({ args: ["commit", "-m", message], cwd });
}

/**
 * `main` at B0 and `feature` at H0 carrying one change, then `main` advanced to B1 by an UNRELATED file and
 * `feature` rebased onto it — H1, the same patch on a new base. Checked out on `feature`.
 */
function rebasedRepo({ label }: { label: string }): { b0: string; b1: string; h0: string; h1: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), `slopweaver-pinned-${label}-`));
  homes.push(root);
  const steps: readonly (readonly string[])[] = [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
    ["remote", "add", "origin", `git@github.com:${REPO}.git`],
  ];
  for (const args of steps) {
    gitInTemp({ args, cwd: root });
  }
  writeFileSync(join(root, "a.txt"), "one\n");
  commitAll({ cwd: root, message: "base" });
  const b0 = revParse({ cwd: root, rev: "HEAD" });
  gitInTemp({ args: ["checkout", "-b", "feature"], cwd: root });
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  commitAll({ cwd: root, message: "the work" });
  const h0 = revParse({ cwd: root, rev: "HEAD" });
  gitInTemp({ args: ["checkout", "main"], cwd: root });
  writeFileSync(join(root, "b.txt"), "unrelated\n");
  commitAll({ cwd: root, message: "main moves" });
  const b1 = revParse({ cwd: root, rev: "HEAD" });
  gitInTemp({ args: ["checkout", "feature"], cwd: root });
  gitInTemp({ args: ["rebase", "main"], cwd: root });
  return { b0, b1, h0, h1: revParse({ cwd: root, rev: "HEAD" }), root };
}

/** Write one pass record where a real pass would have left it — an `artifact.md` beside a `record.json`. */
function writeRecord({
  home,
  id,
  repoRoot,
  scope,
  tree,
  verdict,
}: {
  home: string;
  id: string;
  repoRoot: string;
  scope: Record<string, unknown>;
  tree: { branch: string; dirtyBytes: number; fingerprint: string; headSha: string; treeSha: string };
  verdict: string;
}): void {
  const run = join(stateHomePaths({ home }).orchestration, id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "artifact.md"), `# ${id}\n`);
  writeFileSync(
    join(run, "record.json"),
    JSON.stringify({
      artifactId: id,
      attempts: [],
      bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
      createdAtIso: "2026-11-17T01:00:00.000Z",
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

/**
 * A stale READY plan, and a CLEAN review taken at H0 with `--base <B0's full SHA>` — its digest the real one
 * `codex review` records for B0..H0 (`commitDiffSha.test.ts` proves the two hashes agree).
 *
 * @returns the review's recorded digest
 */
function recordPinnedLoop({ home, b0, h0, root }: { home: string; b0: string; h0: string; root: string }): string {
  const repoRoot = unwrap(resolveRepoRoot({ cwd: root }));
  const atH0 = unwrap(commitTreeFingerprint({ commit: h0, cwd: root }));
  const before = treeFingerprint({ dirtyPatch: "", headSha: h0, treeSha: `${"9".repeat(38)}ab` });
  const reviewed = unwrap(commitDiffSha256({ base: b0, commit: h0, cwd: root }));
  writeRecord({
    home,
    id: "plan-before-the-work",
    repoRoot,
    scope: { mode: "plan", pass: "p2", promptBytes: 1, promptSha256: "abc" },
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: before.digest, headSha: h0, treeSha: before.treeSha },
    verdict: "READY",
  });
  writeRecord({
    home,
    id: "review-pinned-to-b0",
    repoRoot,
    scope: {
      baseRef: b0,
      baseSha: b0,
      diffBytes: 10,
      diffSha256: reviewed,
      headSha: h0,
      mode: "review",
      pass: "r1",
      property: { id: "r1-01", statement: "s" },
    },
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: atH0.digest, headSha: h0, treeSha: atH0.treeSha },
    verdict: "CLEAN",
  });
  return reviewed;
}

/** The landing floor's read of the pull request at `headSha` on `baseSha`. */
async function landingRead({
  baseSha,
  headSha,
  home,
  root,
}: {
  baseSha: string | undefined;
  headSha: string;
  home: string;
  root: string;
}): Promise<LocalCodexLoopRead> {
  return readLocalCodexLoop({
    cwd: root,
    fallbackPort: memoryFallbackRegisterPort(),
    head: { baseSha, branch: "feature", headSha, repository: REPO },
    home,
    signInPort: memoryCodexSignInPort(),
    supersessions: memorySupersessionPort(),
  });
}

/** The failures of a read that answered, throwing on one that refused rather than branching in an assertion. */
function failuresOf({ read }: { read: LocalCodexLoopRead }): readonly string[] {
  if (read.kind !== "read") {
    throw new Error(`expected the floor to read, got ${read.kind}: ${read.reason}`);
  }
  return read.evidence.failures;
}

const NO_CURRENT_REVIEW = "1 review pass(es) ran but none is both current and conclusive";

describe("a review pinned to a base SHA carries across an unchanged rebase", REAL_GIT, () => {
  it("re-diffs differently against its own pinned base, and identically against the new one", () => {
    const { b0, b1, h0, h1, root } = rebasedRepo({ label: "digests" });
    const reviewed = unwrap(commitDiffSha256({ base: b0, commit: h0, cwd: root }));

    expect(h1).not.toBe(h0);
    expect(unwrap(commitDiffSha256({ base: b0, commit: h1, cwd: root }))).not.toBe(reviewed);
    expect(unwrap(commitDiffSha256({ base: b1, commit: h1, cwd: root }))).toBe(reviewed);
  });

  it("clears the landing floor at the rebased head against the pull request's new base", async () => {
    const home = scratchHome({ label: "pinned-clear" });
    const { b0, b1, h0, h1, root } = rebasedRepo({ label: "clear" });
    recordPinnedLoop({ b0, h0, home, root });

    expect(failuresOf({ read: await landingRead({ baseSha: b1, headSha: h1, home, root }) })).toEqual([]);
  });

  /** The floor before this change, and `codex status --check`'s floor still: no pull request base to diff against. */
  it("stays incomplete when no pull request base is known", async () => {
    const home = scratchHome({ label: "pinned-nobase" });
    const { b0, h0, h1, root } = rebasedRepo({ label: "nobase" });
    recordPinnedLoop({ b0, h0, home, root });

    const failures = failuresOf({ read: await landingRead({ baseSha: undefined, headSha: h1, home, root }) });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(NO_CURRENT_REVIEW);
  });

  /**
   * A local `refs/replace` entry pointing the changed head at a commit holding the OLD patch must not make the
   * changed head hash as the reviewed one — found by a Codex review; git honours a replacement even for a full SHA.
   */
  it("stays incomplete when a replacement ref dresses a changed head up as the reviewed patch", async () => {
    const home = scratchHome({ label: "pinned-replaced" });
    const { b0, b1, h0, h1, root } = rebasedRepo({ label: "replaced" });
    recordPinnedLoop({ b0, h0, home, root });
    writeFileSync(join(root, "a.txt"), "one\nTWO\n");
    gitInTemp({ args: ["commit", "-a", "-m", "change the patch"], cwd: root });
    const changed = revParse({ cwd: root, rev: "HEAD" });
    gitInTemp({ args: ["replace", changed, h1], cwd: root });

    const failures = failuresOf({ read: await landingRead({ baseSha: b1, headSha: changed, home, root }) });

    expect(revParse({ cwd: root, rev: `${changed}^{tree}` })).toBe(revParse({ cwd: root, rev: `${h1}^{tree}` }));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(NO_CURRENT_REVIEW);
  });

  it("stays incomplete when the rebase changed one line of the patch", async () => {
    const home = scratchHome({ label: "pinned-changed" });
    const { b0, b1, h0, root } = rebasedRepo({ label: "changed" });
    recordPinnedLoop({ b0, h0, home, root });
    writeFileSync(join(root, "a.txt"), "one\nTWO\n");
    gitInTemp({ args: ["commit", "-a", "--amend", "--no-edit"], cwd: root });
    const changed = revParse({ cwd: root, rev: "HEAD" });

    const failures = failuresOf({ read: await landingRead({ baseSha: b1, headSha: changed, home, root }) });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(NO_CURRENT_REVIEW);
  });
});
