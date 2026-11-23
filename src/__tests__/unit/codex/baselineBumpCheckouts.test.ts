/*
 * Where the ratchet-bump witness read runs (`src/codex/baselineBumpCheckouts.ts`): the merge commit landing would
 * make, and the checkout chosen to read it in. One real repository serves every case — its commits are read,
 * never moved.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateMerge, rootHoldingBoth } from "../../../codex/baselineBumpCheckouts.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** The fixture's commits: a base, two heads that each touch a different file, and one that conflicts with main. */
interface Commits {
  readonly base: string;
  readonly main: string;
  readonly feature: string;
  readonly clash: string;
}

/** The repository every fixture checkout but `elsewhere` names as its `origin`. */
const REPOSITORY = "acme/widget";

let root: string;
let commits: Commits;
/** A full clone of `main` alone, so it holds `base` and `main` but neither detached head. */
let twin: string;
/** A depth-one clone of `main`: it holds `main` and is never eligible. */
let shallow: string;
/** A full clone of `main` whose `origin` names another repository. */
let elsewhere: string;

/**
 * Clone the fixture's `main` into a fresh directory and point its `origin` at a repository slug.
 *
 * @param repository the `owner/name` the clone's `origin` names
 * @param depth a shallow depth, or `undefined` for the whole history
 * @returns the clone's path
 */
function cloneOf({ repository, depth }: { repository: string; depth: number | undefined }): string {
  const into = mkdtempSync(join(tmpdir(), "bump-clone-"));
  const shallowArgs = depth === undefined ? [] : ["--depth", String(depth)];
  gitInTemp({ args: ["clone", "-q", "--branch", "main", ...shallowArgs, `file://${root}`, into], cwd: root });
  gitInTemp({ args: ["remote", "set-url", "origin", `https://github.com/${repository}.git`], cwd: into });
  return into;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bump-checkouts-"));
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  const commitWith = ({ path, text }: { path: string; text: string }): string => {
    writeFileSync(join(root, path), text);
    git("add", ".");
    git("commit", "-q", "-m", path);
    return git("rev-parse", "HEAD");
  };
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  const base = commitWith({ path: "a.txt", text: "a\n" });
  const main = commitWith({ path: "b.txt", text: "main\n" });
  git("checkout", "-q", "--detach", base);
  const feature = commitWith({ path: "c.txt", text: "feature\n" });
  git("checkout", "-q", "--detach", base);
  const clash = commitWith({ path: "b.txt", text: "clash\n" });
  commits = { base, clash, feature, main };
  git("remote", "add", "origin", `https://github.com/${REPOSITORY}.git`);
  twin = cloneOf({ depth: undefined, repository: REPOSITORY });
  shallow = cloneOf({ depth: 1, repository: REPOSITORY });
  elsewhere = cloneOf({ depth: undefined, repository: "acme/other" });
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  for (const dir of [root, twin, shallow, elsewhere]) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("candidateMerge", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("writes the merge of main and the head, main first, holding both sides' files", () => {
    const merged = candidateMerge({ base: commits.main, head: commits.feature, root })!;

    expect(gitInTemp({ args: ["rev-list", "--parents", "-n", "1", merged], cwd: root })).toBe(
      `${merged} ${commits.main} ${commits.feature}`,
    );
    expect(gitInTemp({ args: ["ls-tree", "--name-only", merged], cwd: root })).toBe("a.txt\nb.txt\nc.txt");
  });

  it("answers nothing when the head conflicts with main, never a tree", () => {
    expect(candidateMerge({ base: commits.main, head: commits.clash, root })).toBeUndefined();
  });
});

describe("rootHoldingBoth", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("chooses the full-history checkout of the repository that already holds both commits", () => {
    expect(
      rootHoldingBoth({ commits: [commits.main, commits.feature], repository: REPOSITORY, roots: [root] }),
    ).toEqual({ kind: "found", root });
  });

  it("skips a checkout of another repository holding the commit, for the one that matches", () => {
    expect(rootHoldingBoth({ commits: [commits.main], repository: REPOSITORY, roots: [elsewhere, root] })).toEqual({
      kind: "found",
      root,
    });
    expect(rootHoldingBoth({ commits: [commits.main], repository: "acme/other", roots: [root, elsewhere] })).toEqual({
      kind: "found",
      root: elsewhere,
    });
  });

  it("stops at the first ready checkout of the repository, in candidate order", () => {
    expect(rootHoldingBoth({ commits: [commits.main], repository: REPOSITORY, roots: [twin, root] })).toEqual({
      kind: "found",
      root: twin,
    });
    expect(
      rootHoldingBoth({ commits: [commits.main, commits.feature], repository: REPOSITORY, roots: [twin, root] }),
    ).toEqual({ kind: "found", root });
  });

  it("skips a shallow checkout holding both commits for the full-history one behind it", () => {
    expect(rootHoldingBoth({ commits: [commits.main], repository: REPOSITORY, roots: [shallow, root] })).toEqual({
      kind: "found",
      root,
    });
  });

  it("counts the repository's checkouts when only a shallow one exists, and chooses none", () => {
    expect(rootHoldingBoth({ commits: [commits.main], repository: REPOSITORY, roots: [elsewhere, shallow] })).toEqual({
      kind: "missing",
      repositoryCheckouts: 1,
    });
  });

  it("counts zero when there is no checkout to read in", () => {
    expect(rootHoldingBoth({ commits: [commits.main], repository: REPOSITORY, roots: [] })).toEqual({
      kind: "missing",
      repositoryCheckouts: 0,
    });
  });
});
