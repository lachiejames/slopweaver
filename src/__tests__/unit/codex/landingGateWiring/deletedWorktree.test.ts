/**
 * `readLocalCodexLoop` keeps a plan and a review recorded in a worktree that was later DELETED — when, and only when,
 * a surviving checkout of the same repository re-proves them (`src/codex/orphanedEvidence.ts`).
 *
 * Before the change the first case read both halves NOT RUN after `git worktree remove`, while the main checkout
 * beside it held the very same commit. Every other case is a record that must STILL not count.
 *
 * Zero mocks: real git worktrees, a scratch home, and plain fakes for the ports, per `.claude/rules/testing.md`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateFallbackReview } from "../../../../codex/fallbackReview.js";
import { treeFingerprint } from "../../../../codex/fingerprint.js";
import { commitTreeFingerprint, resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import type { LocalCodexLoopRead } from "../../../../codex/landingGateTypes.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import {
  memoryFallbackRegisterPort,
  putFallbackReceipt,
  putFallbackRequest,
} from "../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../landingRegistersFixture.js";
import { gitInTemp } from "../../../tempGitRepo.js";
import { BASE_SHA, homes, REAL_GIT, REPO, scratchHome } from "./harness.js";

const NO_PLAN = "no planning pass has run on this branch — nothing planned the work before it was written";
const NO_REVIEW = "no general review pass has run on this branch — the diff has never been read by the second brain";

/** One pass record, written where a real pass leaves it; `originRepository` omitted writes a pre-binding record. */
function writeRecord({
  home,
  id,
  mode,
  originRepository,
  repoRoot,
  tree,
  verdict,
}: {
  home: string;
  id: string;
  mode: "plan" | "review";
  originRepository: string | undefined;
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
      ...(originRepository === undefined ? {} : { originRepository }),
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

/** A `main` checkout whose `origin` is {@link REPO}, plus an `authoring` worktree with one commit on `feature`. */
function repoWithWorktree({ label }: { label: string }): {
  dir: string;
  main: string;
  authoring: string;
  authoringRoot: string;
  headSha: string;
} {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-gone-${label}-`));
  homes.push(dir);
  const main = join(dir, "main");
  mkdirSync(main, { recursive: true });
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
    ["remote", "add", "origin", `git@github.com:${REPO}.git`],
  ]) {
    gitInTemp({ args, cwd: main });
  }
  writeFileSync(join(main, "a.txt"), "zero\n");
  gitInTemp({ args: ["add", "-A"], cwd: main });
  gitInTemp({ args: ["commit", "-m", "base"], cwd: main });
  const authoring = join(dir, "authoring");
  gitInTemp({ args: ["worktree", "add", "-b", "feature", authoring], cwd: main });
  writeFileSync(join(authoring, "a.txt"), "one\n");
  gitInTemp({ args: ["commit", "-am", "the work"], cwd: authoring });
  const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: authoring }).trim();
  return { authoring, authoringRoot: unwrap(resolveRepoRoot({ cwd: authoring })), dir, headSha, main };
}

/** A READY plan (STALE against the head) and a CLEAN review (CURRENT at `reviewedSha`), both recorded in `repoRoot`. */
function writeLoop({
  home,
  originRepository,
  repoRoot,
  reviewedSha,
  cwd,
}: {
  home: string;
  originRepository: string | undefined;
  repoRoot: string;
  reviewedSha: string;
  cwd: string;
}): void {
  const atHead = unwrap(commitTreeFingerprint({ commit: reviewedSha, cwd }));
  const before = treeFingerprint({ dirtyPatch: "", headSha: reviewedSha, treeSha: `${"9".repeat(38)}ab` });
  writeRecord({
    home,
    id: "plan",
    mode: "plan",
    originRepository,
    repoRoot,
    tree: {
      branch: "feature",
      dirtyBytes: 0,
      fingerprint: before.digest,
      headSha: reviewedSha,
      treeSha: before.treeSha,
    },
    verdict: "READY",
  });
  writeRecord({
    home,
    id: "review",
    mode: "review",
    originRepository,
    repoRoot,
    tree: {
      branch: "feature",
      dirtyBytes: 0,
      fingerprint: atHead.digest,
      headSha: reviewedSha,
      treeSha: atHead.treeSha,
    },
    verdict: "CLEAN",
  });
}

/** The landing read from `cwd` for the pull request at `headSha` on `feature`. */
function readFrom({ cwd, home, headSha }: { cwd: string; home: string; headSha: string }): Promise<LocalCodexLoopRead> {
  return readLocalCodexLoop({
    cwd,
    fallbackPort: memoryFallbackRegisterPort(),
    head: { baseSha: BASE_SHA, branch: "feature", headSha, repository: REPO },
    home,
    signInPort: memoryCodexSignInPort(),
    supersessions: memorySupersessionPort(),
  });
}

/** The failures and roots a read produced, thrown on when it refused rather than branched on. */
function verdictOf({ read }: { read: LocalCodexLoopRead }): { failures: readonly string[]; roots: readonly string[] } {
  if (read.kind !== "read") {
    throw new Error(`the read refused: ${read.reason}`);
  }
  return { failures: read.evidence.failures, roots: read.evidence.roots };
}

describe("a deleted worktree's plan and review", REAL_GIT, () => {
  it("still count once the worktree is removed, re-proved by the main checkout holding the same head", async () => {
    const home = scratchHome({ label: "gone" });
    const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label: "gone" });
    const mainRoot = unwrap(resolveRepoRoot({ cwd: main }));
    writeLoop({ cwd: authoring, home, originRepository: REPO, repoRoot: authoringRoot, reviewedSha: headSha });

    const whileStanding = verdictOf({ read: await readFrom({ cwd: main, headSha, home }) });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });
    const afterRemoval = verdictOf({ read: await readFrom({ cwd: main, headSha, home }) });

    expect(whileStanding).toEqual({ failures: [], roots: [mainRoot, authoringRoot] });
    expect(afterRemoval).toEqual({ failures: [], roots: [mainRoot] });
  });

  it("count when the recorded head is an ANCESTOR of the pull request's head", async () => {
    const home = scratchHome({ label: "gone-ancestor" });
    const { authoring, authoringRoot, headSha: reviewedSha, main } = repoWithWorktree({ label: "gone-ancestor" });
    const mainRoot = unwrap(resolveRepoRoot({ cwd: main }));
    writeLoop({ cwd: authoring, home, originRepository: REPO, repoRoot: authoringRoot, reviewedSha });
    gitInTemp({ args: ["commit", "--allow-empty", "-m", "a later commit"], cwd: authoring });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: authoring }).trim();
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });

    // The review read the tree the head still has (the later commit is empty), so it stays CURRENT once placed.
    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) })).toEqual({
      failures: [],
      roots: [mainRoot],
    });
  });

  it("stay NOT RUN when they were written before the origin binding existed", async () => {
    const home = scratchHome({ label: "gone-legacy" });
    const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label: "gone-legacy" });
    writeLoop({ cwd: authoring, home, originRepository: undefined, repoRoot: authoringRoot, reviewedSha: headSha });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });

    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("stay NOT RUN when their binding names another repository, though this clone holds the same commit", async () => {
    const home = scratchHome({ label: "gone-fork" });
    const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label: "gone-fork" });
    writeLoop({ cwd: authoring, home, originRepository: "fork/widget", repoRoot: authoringRoot, reviewedSha: headSha });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });

    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("stay NOT RUN when a malformed binding is recorded", async () => {
    const home = scratchHome({ label: "gone-malformed" });
    const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label: "gone-malformed" });
    writeLoop({ cwd: authoring, home, originRepository: `${REPO}/..`, repoRoot: authoringRoot, reviewedSha: headSha });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });

    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("stay NOT RUN when they recorded a head that is not the pull request's head or an ancestor of it", async () => {
    const home = scratchHome({ label: "gone-sibling" });
    const { authoring, authoringRoot, headSha: siblingSha, dir, main } = repoWithWorktree({ label: "gone-sibling" });
    writeLoop({ cwd: authoring, home, originRepository: REPO, repoRoot: authoringRoot, reviewedSha: siblingSha });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });
    // The pull request's `feature` is a different line of work, cut from main, so the recorded commit is held
    // here yet is no ancestor of the head being landed.
    const landing = join(dir, "landing");
    gitInTemp({ args: ["worktree", "add", "-b", "feature-2", landing, "main"], cwd: main });
    writeFileSync(join(landing, "b.txt"), "other\n");
    gitInTemp({ args: ["add", "-A"], cwd: landing });
    gitInTemp({ args: ["commit", "-m", "other work"], cwd: landing });
    const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: landing }).trim();

    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("count a Claude fallback review receipt the same way, and only when its REQUEST FILE carries the binding", async () => {
    const results: { failures: readonly string[]; roots: readonly string[] }[] = [];
    // The third variant embeds a binding its hash-bound request file never carried: the copy is not the evidence.
    const variants = [
      { embedded: REPO, file: REPO, label: "gone-receipt" },
      { embedded: undefined, file: undefined, label: "gone-receipt-legacy" },
      { embedded: REPO, file: undefined, label: "gone-receipt-embedded-only" },
    ] as const;
    for (const { embedded, file, label } of variants) {
      const home = scratchHome({ label });
      const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label });
      writeLoop({ cwd: authoring, home, originRepository: REPO, repoRoot: authoringRoot, reviewedSha: headSha });
      // Replace the Codex review with a Claude receipt, so only the receipt can supply the review half.
      rmSync(join(stateHomePaths({ home }).orchestration, "review"), { force: true, recursive: true });
      const now = unwrap(commitTreeFingerprint({ commit: headSha, cwd: authoring }));
      const request = {
        baseRef: "origin/main",
        baseSha: BASE_SHA,
        capEvidence: {
          blockedBy: "capped",
          limitId: "premium",
          observedAtIso: "2026-09-13T14:49:01.803Z",
          reachedType: null,
        },
        createdAtIso: "2026-09-14T01:00:00.000Z",
        diffBytes: 1,
        diffSha256: "d".repeat(64),
        headSha,
        pass: "r1",
        property: { id: "r1-01", statement: "s" },
        repoRoot: authoringRoot,
        requestId: `req-${label}`,
        schemaVersion: 1,
        tree: { branch: "feature", dirtyBytes: 0, fingerprint: now.digest, headSha, treeSha: now.treeSha },
      } as const;
      const fallbackPort = memoryFallbackRegisterPort();
      const onDisk = { ...request, ...(file === undefined ? {} : { originRepository: file }) };
      const requestBytes = await putFallbackRequest({ home, port: fallbackPort, request: onDisk });
      const answer = JSON.stringify({
        counterexample: "",
        evidence: "e",
        propertyId: "r1-01",
        summary: "s",
        verdict: "CLEAN",
      });
      const receipt = unwrap(
        validateFallbackReview({
          answer,
          completedAtIso: "2026-09-14T01:30:00.000Z",
          now,
          receiptId: `rcpt-${label}`,
          request: { ...request, ...(embedded === undefined ? {} : { originRepository: embedded }) },
          requestBytes,
          reviewer: { host: "claude-code", model: null, workspace: null },
        }),
      );
      await putFallbackReceipt({ home, port: fallbackPort, receipt });
      gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });
      const read = await readLocalCodexLoop({
        cwd: main,
        fallbackPort,
        head: { baseSha: BASE_SHA, branch: "feature", headSha, repository: REPO },
        home,
        signInPort: memoryCodexSignInPort(),
        supersessions: memorySupersessionPort(),
      });
      results.push({ ...verdictOf({ read }), roots: [] });
    }

    expect(results.map((one) => one.failures.map((line) => line.startsWith(NO_REVIEW)))).toEqual([[], [true], [true]]);
  });

  it("stay NOT RUN when the surviving checkout does not hold the reviewed commit, though the origin matches", async () => {
    const home = scratchHome({ label: "gone-absent" });
    const { dir, headSha, main } = repoWithWorktree({ label: "gone-absent" });
    // A second clone of the SAME repository commits work main never fetched, records its passes, and is deleted:
    // the binding and branch match, and only the content proof can refuse it.
    const clone = join(dir, "clone");
    gitInTemp({ args: ["clone", "--quiet", "--branch", "feature", main, clone], cwd: dir });
    // A clone copies no local config, so it carries its own identity rather than relying on a global one CI lacks.
    for (const args of [
      ["config", "user.email", "dev@example.invalid"],
      ["config", "user.name", "Dev"],
      ["remote", "set-url", "origin", `git@github.com:${REPO}.git`],
    ]) {
      gitInTemp({ args, cwd: clone });
    }
    writeFileSync(join(clone, "a.txt"), "unfetched\n");
    gitInTemp({ args: ["commit", "-am", "work main never saw"], cwd: clone });
    const unfetched = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: clone }).trim();
    const cloneRoot = unwrap(resolveRepoRoot({ cwd: clone }));
    writeLoop({ cwd: clone, home, originRepository: REPO, repoRoot: cloneRoot, reviewedSha: unfetched });
    rmSync(clone, { force: true, recursive: true });

    expect(gitInTemp({ args: ["cat-file", "-t", headSha], cwd: main }).trim()).toBe("commit");
    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });

  it("stay NOT RUN when the recorded path now holds a checkout of ANOTHER repository", async () => {
    const home = scratchHome({ label: "gone-reused" });
    const { authoring, authoringRoot, headSha, main } = repoWithWorktree({ label: "gone-reused" });
    writeLoop({ cwd: authoring, home, originRepository: REPO, repoRoot: authoringRoot, reviewedSha: headSha });
    gitInTemp({ args: ["worktree", "remove", "--force", authoring], cwd: main });
    // The path exists again, so it is judged by today's qualification, which a foreign `origin` fails.
    mkdirSync(authoring, { recursive: true });
    gitInTemp({ args: ["init", "--initial-branch=feature"], cwd: authoring });
    gitInTemp({ args: ["remote", "add", "origin", "git@github.com:other/thing.git"], cwd: authoring });

    expect(verdictOf({ read: await readFrom({ cwd: main, headSha, home }) }).failures).toEqual([NO_PLAN, NO_REVIEW]);
  });
});
