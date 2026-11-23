/**
 * `lapBatchShell.ts` over real git: the squash chain a batch simulates is the chain `git merge --squash` lands
 * member by member, a conflict between two members is reported with its path, and what the batch measures for a
 * member over its simulated link is what it measures again over the real landed tip. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts` builds every fixture.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lapBatchSeams } from "../../../../../cli/commands/github/lapBatchShell.js";
import type { SquashOutcome } from "../../../../../cli/commands/github/lapDeps.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository on `main` with one root commit. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lap-batch-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: dir });
  writeFileSync(join(dir, "shared.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "root"], cwd: dir });
  return dir;
}

/** Commit one file on a new branch forked from `from`, and return its head. */
function branch({
  dir,
  name,
  from,
  file,
  content,
}: {
  dir: string;
  name: string;
  from: string;
  file: string;
  content: string;
}): string {
  gitInTemp({ args: ["checkout", "-q", "-b", name, from], cwd: dir });
  writeFileSync(join(dir, file), content);
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-q", "-m", name], cwd: dir });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
}

/** The clean squash, failing the test on a conflict. */
function clean({ outcome }: { outcome: SquashOutcome }): { tree: string; commit: string } {
  expect(outcome.kind).toBe("clean");
  return outcome as { tree: string; commit: string };
}

/** Squash-merge `head` onto `main` exactly as `git merge --squash` and a commit do, returning the new tip. */
function squashOntoMain({ dir, head }: { dir: string; head: string }): string {
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: dir });
  gitInTemp({ args: ["merge", "-q", "--squash", head], cwd: dir });
  gitInTemp({ args: ["commit", "-q", "-m", "squash"], cwd: dir });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
}

/** A fixture: two members forked from the root, then `main` moved past both with a file neither has. */
function twoMembers(): { dir: string; base: string; first: string; second: string } {
  const dir = initRepo();
  const root = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
  const first = branch({ content: "a\n", dir, file: "a.txt", from: root, name: "first" });
  const second = branch({ content: "b\n", dir, file: "b.txt", from: root, name: "second" });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: dir });
  writeFileSync(join(dir, "c.txt"), "c\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-q", "-m", "base moved"], cwd: dir });
  return { base: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir }), dir, first, second };
}

describe("lapBatchSeams over real git", REAL_GIT_SUITE, () => {
  it("simulates the chain `git merge --squash` lands, each link one parent on the one before", () => {
    const { dir, base, first, second } = twoMembers();
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: base })) });
    const two = clean({ outcome: unwrap(seams.simulateSquash({ head: second, message: "s2", onto: one.commit })) });
    expect(unwrap(seams.commitFacts({ sha: one.commit }))).toEqual({
      parents: [base],
      sha: one.commit,
      tree: one.tree,
    });
    expect(unwrap(seams.commitFacts({ sha: two.commit })).parents).toEqual([one.commit]);

    const landedOne = squashOntoMain({ dir, head: first });
    const landedTwo = squashOntoMain({ dir, head: second });
    expect(unwrap(seams.commitFacts({ sha: landedOne }))).toEqual({ parents: [base], sha: landedOne, tree: one.tree });
    expect(unwrap(seams.commitFacts({ sha: landedTwo }))).toEqual({
      parents: [landedOne],
      sha: landedTwo,
      tree: two.tree,
    });
  });

  it("measures the same base-moved paths for a member over its simulated link as over the real landed tip", () => {
    const { dir, base, first, second } = twoMembers();
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: base })) });
    const overLink = unwrap(seams.memberMergeFacts({ base: one.commit, head: second }));
    expect(overLink).toEqual({
      baseMoved: ["a.txt", "c.txt"],
      headChanged: ["b.txt"],
      headContainsTip: false,
      reverted: [],
    });
    expect(unwrap(seams.memberMergeFacts({ base, head: first }))).toEqual({
      baseMoved: ["c.txt"],
      headChanged: ["a.txt"],
      headContainsTip: false,
      reverted: [],
    });

    const landedOne = squashOntoMain({ dir, head: first });
    expect(unwrap(seams.memberMergeFacts({ base: landedOne, head: second }))).toEqual(overLink);
  });

  it("measures a member restoring content the chain's history held, naming the commit that held it", () => {
    const dir = initRepo();
    const root = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    writeFileSync(join(dir, "shared.txt"), "two\n");
    gitInTemp({ args: ["commit", "-q", "-am", "base changes shared"], cwd: dir });
    const base = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    const first = branch({ content: "a\n", dir, file: "a.txt", from: base, name: "first" });
    const second = branch({ content: "one\n", dir, file: "shared.txt", from: base, name: "second" });
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: base })) });
    expect(unwrap(seams.memberMergeFacts({ base: one.commit, head: second })).reverted).toEqual([
      { path: "shared.txt", restoresBaseCommit: root },
    ]);
    expect(unwrap(seams.memberMergeFacts({ base, head: first })).reverted).toEqual([]);
  });

  it("reports a conflict between two members with the path they both changed", () => {
    const dir = initRepo();
    const root = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    const first = branch({ content: "first\n", dir, file: "shared.txt", from: root, name: "first" });
    const second = branch({ content: "second\n", dir, file: "shared.txt", from: root, name: "second" });
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: root })) });
    expect(unwrap(seams.simulateSquash({ head: second, message: "s2", onto: one.commit }))).toEqual({
      kind: "conflict",
      paths: ["shared.txt"],
    });
  });

  it("reads a landed commit's real parents and tree past a local replace ref", () => {
    const { dir, base, first, second } = twoMembers();
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: base })) });
    const landed = squashOntoMain({ dir, head: second });
    gitInTemp({ args: ["replace", landed, one.commit], cwd: dir });
    expect(unwrap(seams.commitFacts({ sha: landed })).tree).toBe(
      gitInTemp({ args: ["--no-replace-objects", "rev-parse", `${landed}^{tree}`], cwd: dir }),
    );
    expect(unwrap(seams.commitFacts({ sha: landed })).tree).not.toBe(one.tree);
  });

  it("refuses a clean merge whose stdout a merge driver also wrote to, never taking its line as the tree", () => {
    const dir = initRepo();
    writeFileSync(join(dir, ".gitattributes"), "shared.txt merge=noisy\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-q", "-m", "attributes"], cwd: dir });
    gitInTemp({ args: ["config", "merge.noisy.driver", `printf '${"1".repeat(40)}\\n'`], cwd: dir });
    const root = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    const first = branch({ content: "first\n", dir, file: "shared.txt", from: root, name: "first" });
    const second = branch({ content: "second\n", dir, file: "shared.txt", from: root, name: "second" });
    const seams = lapBatchSeams({ cwd: dir });
    const one = clean({ outcome: unwrap(seams.simulateSquash({ head: first, message: "s1", onto: root })) });
    const noisy = unwrapErr(seams.simulateSquash({ head: second, message: "s2", onto: one.commit }));
    expect(noisy.message).toContain("a clean merge-tree printed 2 line(s), not exactly one object id");
    gitInTemp({ args: ["config", "merge.noisy.driver", "printf '\\n'; cp %B %A"], cwd: dir });
    const blank = unwrapErr(seams.simulateSquash({ head: second, message: "s2", onto: one.commit }));
    expect(blank.message).toContain("a clean merge-tree printed 2 line(s), not exactly one object id");
  });
});
