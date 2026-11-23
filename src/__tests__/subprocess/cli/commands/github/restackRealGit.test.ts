/**
 * The whole-forest restack, proved against real git on a real three-branch stack.
 *
 * This is the case the owner asked for: a trunk that moved, a stack of three above it, and the
 * requirement that all three move together or none of them does. Every git call goes through `gitInTemp`,
 * the repo's one sanctioned door, and the restack primitive is the shipped one — the deps object here is a
 * seam onto real git, not a fake of it.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import {
  adoptRestackedBranch,
  restackOneBranch,
  restackStagingRef,
} from "../../../../../cli/commands/github/restackExec.js";
import { err, ok, type Result, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const GEN = "2026-09-09T16-00-00-000Z-abcd1234";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Real git, through the sanctioned door, in the shape the restack primitive takes. */
function realGit(): GithubPushDeps {
  return {
    cwd: () => process.cwd(),
    doorLedger: memoryDoorLedger().port,
    out: () => undefined,
    readGit: ({ args, cwd }: { cwd: string; args: readonly string[] }) => gitInTemp({ args, cwd }),
    writeGit: ({ args, cwd }: { cwd: string; args: readonly string[] }): Result<void, string> => {
      try {
        gitInTemp({ args, cwd });
        return ok(undefined);
      } catch (error: unknown) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** Commit one file's contents on the checked-out branch, and answer the new commit. */
function commit({ body, message, name, root }: { body: string; message: string; name: string; root: string }): string {
  writeFileSync(join(root, name), body);
  gitInTemp({ args: ["add", name], cwd: root });
  gitInTemp({ args: ["commit", "-m", message], cwd: root });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root });
}

/** A repository with `main`, and a stack of `one` -> `two` -> `three` above the commit `main` started at. */
function stackedRepo(): {
  readonly root: string;
  readonly forkPoint: string;
  readonly heads: ReadonlyMap<string, string>;
} {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-restack-fixture-"));
  roots.push(root);
  gitInTemp({ args: ["init", "--initial-branch", "main"], cwd: root });
  gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: root });
  gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: root });
  const forkPoint = commit({ body: "base\n", message: "base", name: "base.txt", root });
  const heads = new Map<string, string>();
  gitInTemp({ args: ["checkout", "-b", "one"], cwd: root });
  heads.set("one", commit({ body: "one\n", message: "one", name: "one.txt", root }));
  gitInTemp({ args: ["checkout", "-b", "two"], cwd: root });
  heads.set("two", commit({ body: "two\n", message: "two", name: "two.txt", root }));
  gitInTemp({ args: ["checkout", "-b", "three"], cwd: root });
  heads.set("three", commit({ body: "three\n", message: "three", name: "three.txt", root }));
  gitInTemp({ args: ["checkout", "main"], cwd: root });
  return { forkPoint, heads, root };
}

describe("restackOneBranch on real git", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("moves a whole three-branch stack onto a trunk that advanced, and each entry onto the one below", () => {
    const { forkPoint, heads, root } = stackedRepo();
    const deps = realGit();
    const movedTrunk = commit({ body: "moved\n", message: "trunk moves", name: "trunk.txt", root });

    const one = restackOneBranch({
      deps,
      repoRoot: root,
      target: {
        generationId: GEN,
        branch: "one",
        headSha: heads.get("one")!,
        newBaseSha: movedTrunk,
        oldBaseSha: forkPoint,
      },
    });
    expect(one.kind).toBe("restacked");
    const oneSha = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "one", generationId: GEN })],
      cwd: root,
    });

    const two = restackOneBranch({
      deps,
      repoRoot: root,
      target: {
        generationId: GEN,
        branch: "two",
        headSha: heads.get("two")!,
        newBaseSha: oneSha,
        oldBaseSha: heads.get("one")!,
      },
    });
    expect(two.kind).toBe("restacked");
    const twoSha = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "two", generationId: GEN })],
      cwd: root,
    });

    const three = restackOneBranch({
      deps,
      repoRoot: root,
      target: {
        generationId: GEN,
        branch: "three",
        headSha: heads.get("three")!,
        newBaseSha: twoSha,
        oldBaseSha: heads.get("two")!,
      },
    });
    expect(three.kind).toBe("restacked");
    const threeSha = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "three", generationId: GEN })],
      cwd: root,
    });

    // The property the owner asked for: the whole stack is linear on the new trunk.
    expect(gitInTemp({ args: ["rev-list", "--count", `${movedTrunk}..${threeSha}`], cwd: root })).toBe("3");
    expect(gitInTemp({ args: ["rev-list", "--left-right", "--count", `${oneSha}...${threeSha}`], cwd: root })).toBe(
      "0\t2",
    );
    expect(gitInTemp({ args: ["rev-list", "--left-right", "--count", `${twoSha}...${threeSha}`], cwd: root })).toBe(
      "0\t1",
    );
    // Every file survives the replay, including the trunk's own new one.
    const tree = gitInTemp({ args: ["ls-tree", "--name-only", threeSha], cwd: root });
    expect(tree.split("\n").toSorted()).toEqual(["base.txt", "one.txt", "three.txt", "trunk.txt", "two.txt"]);
  });

  it("replays a branch of more than one commit, which the one-commit rule refuses today", () => {
    const { forkPoint, root } = stackedRepo();
    const deps = realGit();
    gitInTemp({ args: ["checkout", "one"], cwd: root });
    commit({ body: "second\n", message: "one, again", name: "one-more.txt", root });
    const head = commit({ body: "third\n", message: "one, once more", name: "one-again.txt", root });
    gitInTemp({ args: ["checkout", "main"], cwd: root });
    const movedTrunk = commit({ body: "moved\n", message: "trunk moves", name: "trunk.txt", root });

    const outcome = restackOneBranch({
      deps,
      repoRoot: root,
      target: { generationId: GEN, branch: "one", headSha: head, newBaseSha: movedTrunk, oldBaseSha: forkPoint },
    });

    expect(outcome.kind).toBe("restacked");
    const moved = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "one", generationId: GEN })],
      cwd: root,
    });
    expect(gitInTemp({ args: ["rev-list", "--count", `${movedTrunk}..${moved}`], cwd: root })).toBe("3");
  });

  it("reports a conflict by naming the path, and leaves no rebase and no scratch worktree behind", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-restack-conflict-"));
    roots.push(root);
    gitInTemp({ args: ["init", "--initial-branch", "main"], cwd: root });
    gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: root });
    gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: root });
    const forkPoint = commit({ body: "original\n", message: "base", name: "shared.txt", root });
    gitInTemp({ args: ["checkout", "-b", "feature"], cwd: root });
    const head = commit({ body: "the branch's line\n", message: "branch edit", name: "shared.txt", root });
    gitInTemp({ args: ["checkout", "main"], cwd: root });
    const movedTrunk = commit({ body: "the trunk's line\n", message: "trunk edit", name: "shared.txt", root });

    const outcome = restackOneBranch({
      deps: realGit(),
      repoRoot: root,
      target: { generationId: GEN, branch: "feature", headSha: head, newBaseSha: movedTrunk, oldBaseSha: forkPoint },
    });

    expect(outcome.kind).toBe("conflict");
    expect(outcome.kind === "conflict" ? outcome.reason : "").toBe("conflicting: shared.txt");
    expect(gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: root }).split("worktree ").length).toBe(2);
    expect(gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root })).toBe(movedTrunk);
  });

  it("runs no repository hook in its scratch worktree, so a post-checkout hook cannot write for it", () => {
    const { forkPoint, heads, root } = stackedRepo();
    const hooks = join(root, "hooks-that-must-not-run");
    mkdirSync(hooks, { recursive: true });
    const witness = join(root, "the-hook-ran");
    writeFileSync(join(hooks, "post-checkout"), `#!/bin/sh\necho ran > ${witness}\n`, { mode: 0o755 });
    gitInTemp({ args: ["config", "core.hooksPath", hooks], cwd: root });
    const movedTrunk = commit({ body: "moved\n", message: "trunk moves", name: "trunk.txt", root });

    const outcome = restackOneBranch({
      deps: realGit(),
      repoRoot: root,
      target: {
        branch: "one",
        generationId: GEN,
        headSha: heads.get("one")!,
        newBaseSha: movedTrunk,
        oldBaseSha: forkPoint,
      },
    });

    expect(outcome.kind).toBe("restacked");
    expect(existsSync(witness)).toBe(false);
    // The witness can fire: the same hook, on an ordinary checkout in the same repository, writes the file.
    gitInTemp({ args: ["checkout", "--detach", movedTrunk], cwd: root });
    expect(existsSync(witness)).toBe(true);
  });
});

describe("adoptRestackedBranch on real git", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("moves a branch nothing has checked out onto its restacked commits", () => {
    const { forkPoint, heads, root } = stackedRepo();
    const deps = realGit();
    const movedTrunk = commit({ body: "moved\n", message: "trunk moves", name: "trunk.txt", root });
    const outcome = restackOneBranch({
      deps,
      repoRoot: root,
      target: {
        generationId: GEN,
        branch: "one",
        headSha: heads.get("one")!,
        newBaseSha: movedTrunk,
        oldBaseSha: forkPoint,
      },
    });
    const toSha = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "one", generationId: GEN })],
      cwd: root,
    });

    const adopted = adoptRestackedBranch({
      branch: "one",
      deps,
      expectedSha: heads.get("one")!,
      repoRoot: root,
      stagedRef: restackStagingRef({ branch: "one", generationId: GEN }),
      toSha,
    });

    expect(outcome.kind).toBe("restacked");
    expect(adopted.isOk()).toBe(true);
    expect(gitInTemp({ args: ["rev-parse", "refs/heads/one"], cwd: root })).toBe(toSha);
  });

  it("refuses to move a branch under a worktree that has it checked out, and says where", () => {
    const { heads, root } = stackedRepo();
    gitInTemp({ args: ["checkout", "one"], cwd: root });

    const adopted = adoptRestackedBranch({
      branch: "one",
      deps: realGit(),
      expectedSha: heads.get("one")!,
      repoRoot: root,
      stagedRef: restackStagingRef({ branch: "one", generationId: GEN }),
      toSha: heads.get("two")!,
    });

    expect(adopted.isErr()).toBe(true);
    expect(unwrapErr(adopted).message).toContain("is checked out in");
    expect(gitInTemp({ args: ["rev-parse", "refs/heads/one"], cwd: root })).toBe(heads.get("one")!);
  });

  it("creates a branch this checkout does not have, which is the ordinary shape in a fresh clone", () => {
    const { forkPoint, heads, root } = stackedRepo();
    const deps = realGit();
    const movedTrunk = commit({ body: "moved\n", message: "trunk moves", name: "trunk.txt", root });
    const outcome = restackOneBranch({
      deps,
      repoRoot: root,
      target: {
        branch: "one",
        generationId: GEN,
        headSha: heads.get("one")!,
        newBaseSha: movedTrunk,
        oldBaseSha: forkPoint,
      },
    });
    const toSha = gitInTemp({
      args: ["rev-parse", restackStagingRef({ branch: "one", generationId: GEN })],
      cwd: root,
    });
    gitInTemp({ args: ["branch", "-D", "one"], cwd: root });

    const adopted = adoptRestackedBranch({
      branch: "one",
      deps,
      expectedSha: heads.get("one")!,
      repoRoot: root,
      stagedRef: restackStagingRef({ branch: "one", generationId: GEN }),
      toSha,
    });

    expect(outcome.kind).toBe("restacked");
    expect(adopted.isOk()).toBe(true);
    expect(gitInTemp({ args: ["rev-parse", "refs/heads/one"], cwd: root })).toBe(toSha);
  });

  it("leaves a branch alone when it no longer holds the value the run measured", () => {
    const { heads, root } = stackedRepo();

    const adopted = adoptRestackedBranch({
      branch: "one",
      deps: realGit(),
      expectedSha: heads.get("three")!,
      repoRoot: root,
      stagedRef: restackStagingRef({ branch: "one", generationId: GEN }),
      toSha: heads.get("two")!,
    });

    expect(adopted.isErr()).toBe(true);
    expect(gitInTemp({ args: ["rev-parse", "refs/heads/one"], cwd: root })).toBe(heads.get("one")!);
  });
});
