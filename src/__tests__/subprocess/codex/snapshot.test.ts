/**
 * Snapshot tests against REAL temporary git repositories.
 *
 * Filesystem and git use is deliberate and sanctioned by `testing.md` for a genuine round-trip, and this is
 * the definitive case: the property under test is "does git, as actually invoked, freeze what we think it
 * freezes?". A fake would only prove the fake agrees with itself — which is precisely how the `git stash
 * create` version would have passed while silently dropping every untracked file.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { captureContentTree, createTreeSnapshot } from "../../../codex/snapshot.js";
import { unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/**
 * Every fixture directory this file has minted, so `afterEach` can remove them. Without this a fixture
 * source repo — as opposed to the snapshot it produces, which each test releases itself — was never
 * cleaned up, so every `yarn test:unit` run left one more `slopweaver-snap-src-*` directory behind.
 * Measured: 348 of them had accumulated under the OS temp dir before this was noticed.
 */
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A staging root scoped to this suite, so `createTreeSnapshot`'s own staging directories land here instead
 * of directly under the OS temp dir.
 *
 * Enumerating that shared directory is what made this suite fail in the first place: measured once,
 * it held 758,840 stale entries across every process that has ever touched it, and a plain `readdirSync` over
 * it took over 100s — well past this test's own timeout. This directory holds nothing but what THIS file's
 * own tests create, so counting it stays cheap no matter how large the shared temp dir grows.
 */
const stagingRoot = mkdtempSync(join(tmpdir(), "slopweaver-snap-test-root-"));

afterAll(() => {
  rmSync(stagingRoot, { force: true, recursive: true });
});

/** How many of createTreeSnapshot's own staging directories exist under this suite's own staging root right now. */
function stagingDirCount(): number {
  return readdirSync(stagingRoot).length;
}

/** A repository with one committed file, one ignored directory, and a `.gitignore`. */
function seededRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-snap-src-"));
  fixtureDirs.push(dir);
  const git = ({ args }: { args: readonly string[] }): string => gitInTemp({ args: [...args], cwd: dir });
  git({ args: ["init", "-q"] });
  git({ args: ["config", "user.email", "test@example.com"] });
  git({ args: ["config", "user.name", "Test"] });
  writeFileSync(join(dir, "tracked.txt"), "committed\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  git({ args: ["add", "-A"] });
  git({ args: ["commit", "-qm", "seed"] });
  return dir;
}

function gitIn({ dir, args }: { dir: string; args: readonly string[] }): string {
  return gitInTemp({ args: [...args], cwd: dir });
}

describe("createTreeSnapshot", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("captures an uncommitted edit to a tracked file", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "UNCOMMITTED\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(readFileSync(join(snapshot.path, "tracked.txt"), "utf8")).toContain("UNCOMMITTED");
    snapshot.release();
  });

  /**
   * The reason this uses a scratch index instead of `git stash create`. Measured against a real repository,
   * `stash create` omits untracked files entirely — so a branch whose change is mostly new source would
   * snapshot to something that barely resembles the tree, and the pass would review code nobody wrote.
   */
  it("captures a brand-new untracked file", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "brand-new.ts"), "export const x = 1;\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(existsSync(join(snapshot.path, "brand-new.ts"))).toBe(true);
    snapshot.release();
  });

  it("excludes an ignored file, so build output never reaches a pass", () => {
    const dir = seededRepo();
    mkdirSync(join(dir, "ignored"), { recursive: true });
    writeFileSync(join(dir, "ignored", "junk.log"), "noise\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(existsSync(join(snapshot.path, "ignored", "junk.log"))).toBe(false);
    snapshot.release();
  });

  /** The whole point: the agent keeps editing and the pass keeps reading the tree it was given. */
  it("does not move when the source tree changes afterwards", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    appendFileSync(join(dir, "tracked.txt"), "EDITED AFTER THE SNAPSHOT\n");

    expect(readFileSync(join(snapshot.path, "tracked.txt"), "utf8")).not.toContain("EDITED AFTER");
    snapshot.release();
  });

  it("leaves the caller's index alone", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "brand-new.ts"), "export const x = 1;\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    // Still untracked in the source repo: `??`, never `A `. Staging happened in a scratch index.
    expect(gitIn({ args: ["status", "--porcelain"], dir })).toContain("?? brand-new.ts");
    snapshot.release();
  });

  it("leaves the caller's stash list alone", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "UNCOMMITTED\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(gitIn({ args: ["stash", "list"], dir }).trim()).toBe("");
    snapshot.release();
  });

  it("adds nothing to the caller's history — the snapshot commit is unreachable", () => {
    const dir = seededRepo();
    const before = gitIn({ args: ["rev-parse", "HEAD"], dir }).trim();

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(gitIn({ args: ["rev-parse", "HEAD"], dir }).trim()).toBe(before);
    expect(snapshot.commit === before).toBe(false);
    snapshot.release();
  });

  it("removes the snapshot on release", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    snapshot.release();

    expect(existsSync(snapshot.path)).toBe(false);
  });

  /**
   * git hands a `post-checkout` hook's exit status back as `worktree add`'s own, and this repository's hook
   * cannot boot in a tree with no `node_modules`. Every real snapshot failed that way, leaving a registration
   * behind for a staging directory the failure path deleted — 42 of them were found.
   */
  it("freezes a repository whose hooks fail, runs none of them, and leaves no registration", () => {
    const dir = seededRepo();
    const marker = join(dir, "hook-ran");
    // `post-index-change` fires on the scratch-index steps before the add, so both are planted.
    for (const name of ["post-checkout", "post-index-change"]) {
      writeFileSync(join(dir, ".git", "hooks", name), `#!/bin/sh\necho ${name} >> "${marker}"\nexit 127\n`, {
        mode: 0o755,
      });
    }
    // A configured fsmonitor is an executable git runs on the same steps, outside `core.hooksPath`.
    const monitor = join(dir, "fsmonitor.sh");
    writeFileSync(monitor, `#!/bin/sh\necho fsmonitor >> "${marker}"\n`, { mode: 0o755 });
    gitIn({ args: ["config", "core.fsmonitor", monitor], dir });

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();
    const frozen = readFileSync(join(snapshot.path, "tracked.txt"), "utf8");
    snapshot.release();
    captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();
    const registered = gitIn({ args: ["worktree", "list", "--porcelain"], dir })
      .split("\n")
      .filter((line) => line.startsWith("worktree "));

    expect(frozen).toBe("committed\n");
    expect(existsSync(marker)).toBe(false);
    expect(registered).toHaveLength(1);
  });

  /**
   * A checkout that fails part-way — a required smudge filter, which hooks-off cannot suppress —
   * must leave no registration and no staging directory. git clears its own half-built worktree here, so this
   * pins the outcome rather than the release inside the add's catch, which is for an add that COMPLETED before
   * reporting failure: the hook case above, no longer reachable with hooks off.
   */
  it("leaves no registration and no staging directory when the checkout itself fails", () => {
    const dir = seededRepo();
    gitIn({ args: ["config", "filter.broken.clean", "cat"], dir });
    gitIn({ args: ["config", "filter.broken.smudge", "false"], dir });
    gitIn({ args: ["config", "filter.broken.required", "true"], dir });
    writeFileSync(join(dir, ".gitattributes"), "*.txt filter=broken\n");
    const before = stagingDirCount();

    const result = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot });
    const registered = gitIn({ args: ["worktree", "list", "--porcelain"], dir })
      .split("\n")
      .filter((line) => line.startsWith("worktree "));

    expect(unwrapErr(result).kind).toBe("io");
    expect(registered).toHaveLength(1);
    expect(stagingDirCount()).toBe(before);
  });

  /** git refuses a LOCKED worktree to a single `--force`, and release deletes the directory regardless. */
  it("deregisters a snapshot someone locked before release", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();
    gitIn({ args: ["worktree", "lock", snapshot.path], dir });

    snapshot.release();
    const registered = gitIn({ args: ["worktree", "list", "--porcelain"], dir })
      .split("\n")
      .filter((line) => line.startsWith("worktree "));

    expect(registered).toHaveLength(1);
    expect(existsSync(snapshot.path)).toBe(false);
  });

  /** Release runs after the verdict exists, so a second call must never cost one. */
  it("survives being released twice", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    snapshot.release();
    snapshot.release();

    expect(existsSync(snapshot.path)).toBe(false);
  });

  /**
   * Release deletes the staging directory recursively BY NAME. A second call after something else recreated
   * that path would delete the replacement, so "safe to call twice" is enforced by a guard rather than by
   * hoping the name is not reused. Found by a review pass of this file.
   */
  it("does not delete a directory that later occupies the same path", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();
    snapshot.release();

    const staging = dirname(snapshot.path);
    fixtureDirs.push(staging);
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "someone-elses.txt"), "not ours\n");
    snapshot.release();

    expect(existsSync(join(staging, "someone-elses.txt"))).toBe(true);
  });

  /**
   * The copy holds git's CANONICAL content, not raw working-tree bytes — measured, and previously
   * overstated in this module's header as byte-identity.
   */
  it("applies the repository's own clean filters, so it is canonical rather than byte-identical", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, ".gitattributes"), "*.txt text eol=lf\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "attrs"], cwd: dir });
    writeFileSync(join(dir, "tracked.txt"), "changed\r\n");

    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(readFileSync(join(snapshot.path, "tracked.txt"), "utf8")).toBe("changed\n");
    snapshot.release();
  });

  it("returns a typed error rather than throwing when the directory is not a repository", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-snap-norepo-"));
    fixtureDirs.push(notARepo);

    const result = createTreeSnapshot({ repoRoot: notARepo, stagingParent: stagingRoot });
    expect(unwrapErr(result).kind).toBe("io");
    expect(unwrapErr(result).operation).toBe("codex.createTreeSnapshot");
  });

  /**
   * `mkdtempSync` mints the staging directory before any git command runs, so a failure on the very first
   * one — exactly what "not a repository" produces — used to leave that directory behind for good: there is
   * no `TreeSnapshot`, so there is no `release()` to call. This was the largest real contributor to the
   * 407-directory backlog this suite's own fixtures had already produced.
   */
  it("cleans up its own staging directory when repoRoot is not a repository", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-snap-norepo-"));
    fixtureDirs.push(notARepo);
    const before = stagingDirCount();

    createTreeSnapshot({ repoRoot: notARepo, stagingParent: stagingRoot });

    expect(stagingDirCount()).toBe(before);
  });
});

/**
 * The comparison a pass uses to ask whether the frozen copy holds what the live tree holds.
 *
 * Every case here is real git, for the same reason the suite above is: the property under test is whether
 * git's own content address of two things agrees, and a fake would only prove the fake agrees with itself.
 * That is not hypothetical — the mechanism this replaced was a pair of fingerprints that agreed with
 * themselves on a clean tree and could never agree on a dirty one.
 */
describe("contentTree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * THE witness for the defect. `stableTree` used to compare a fingerprint of the copy against a fingerprint
   * of the live repository, and on a dirty tree those are digests over different decompositions — so the
   * comparison rejected every dirty tree, no provenance was recorded, and the plan floor was unreachable.
   *
   * Both halves are asserted, because a passing equality is only evidence if the input carries the divergence
   * it calls absent: the fingerprints DISAGREE on this very tree, and the content trees AGREE.
   */
  it("agrees with the live tree on a DIRTY tree, where the two fingerprints cannot", () => {
    const dir = seededRepo();
    appendFileSync(join(dir, "tracked.txt"), "UNCOMMITTED\n");
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    const liveFingerprint = captureTreeFingerprint({ cwd: dir })._unsafeUnwrap();
    const copyFingerprint = captureTreeFingerprint({ cwd: snapshot.path })._unsafeUnwrap();
    const liveContentTree = captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(liveFingerprint.digest === copyFingerprint.digest).toBe(false);
    expect(liveFingerprint.dirtyBytes > 0).toBe(true);
    expect(copyFingerprint.dirtyBytes).toBe(0);
    expect(snapshot.contentTree).toBe(liveContentTree);
    snapshot.release();
  });

  it("agrees with the live tree on a clean tree", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(snapshot.contentTree).toBe(
      captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap(),
    );
    expect(snapshot.contentTree).toBe(gitIn({ args: ["rev-parse", "HEAD^{tree}"], dir }).trim());
    snapshot.release();
  });

  /** The `git stash create` blind spot, restated at the level of the content address. */
  it("agrees with the live tree when the only change is an untracked file", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "brand-new.ts"), "export const x = 1;\n");
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    const liveContentTree = captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(snapshot.contentTree).toBe(liveContentTree);
    expect(snapshot.contentTree === gitIn({ args: ["rev-parse", "HEAD^{tree}"], dir }).trim()).toBe(false);
    snapshot.release();
  });

  /**
   * The axis that looked like a loss and is a gain. A skip-worktree bit lives in the caller's INDEX, and the
   * scratch index is built fresh from `read-tree HEAD`, so it carries no such bit and `git add -A` stages the
   * real working-tree content. `git diff HEAD` is asserted empty in the same test, which is what makes this
   * falsifiable rather than a tautology: the content address sees an edit git will not report at all.
   *
   * Not an exotic case — 62 of 89 acme-admin worktrees carry one, as measured
   * (`git -C <worktree> ls-files -v | grep '^S '`).
   */
  it("addresses a skip-worktree edit that git diff refuses to report", () => {
    const dir = seededRepo();
    gitIn({ args: ["update-index", "--skip-worktree", "tracked.txt"], dir });
    writeFileSync(join(dir, "tracked.txt"), "HIDDEN EDIT\n");
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    const liveContentTree = captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(gitIn({ args: ["diff", "HEAD"], dir }).trim()).toBe("");
    expect(snapshot.contentTree).toBe(liveContentTree);
    expect(snapshot.contentTree === gitIn({ args: ["rev-parse", "HEAD^{tree}"], dir }).trim()).toBe(false);
    expect(readFileSync(join(snapshot.path, "tracked.txt"), "utf8")).toBe("HIDDEN EDIT\n");
    snapshot.release();
  });

  /** The comparison has to be able to DISAGREE, or agreeing proves nothing. This is the A→B half. */
  it("stops agreeing once the live tree moves past the frozen copy", () => {
    const dir = seededRepo();
    const snapshot = createTreeSnapshot({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    appendFileSync(join(dir, "tracked.txt"), "EDITED AFTER THE SNAPSHOT\n");
    const liveContentTree = captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(snapshot.contentTree === liveContentTree).toBe(false);
    snapshot.release();
  });

  /**
   * The scratch index must not land inside the repository. Written there, the very next `git add -A` stages
   * the index file itself and two identical trees address differently — measured while building this, and it
   * looks like a git subtlety rather than a bug in the caller.
   */
  it("writes nothing into the repository it addresses", () => {
    const dir = seededRepo();
    const before = gitIn({ args: ["status", "--porcelain"], dir });

    captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();

    expect(gitIn({ args: ["status", "--porcelain"], dir })).toBe(before);
    expect(existsSync(join(dir, "index"))).toBe(false);
  });

  it("removes its own scratch directory, whether or not git succeeded", () => {
    const dir = seededRepo();
    const notARepo = mkdtempSync(join(tmpdir(), "slopweaver-snap-norepo-"));
    fixtureDirs.push(notARepo);
    const before = stagingDirCount();

    captureContentTree({ repoRoot: dir, stagingParent: stagingRoot })._unsafeUnwrap();
    const failed = captureContentTree({ repoRoot: notARepo, stagingParent: stagingRoot });

    expect(failed.isErr()).toBe(true);
    expect(stagingDirCount()).toBe(before);
  });
});
