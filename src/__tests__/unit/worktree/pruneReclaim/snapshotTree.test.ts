/*
 * A one-off Codex snapshot goes only while it is still cold when the removal re-reads it, and only at the HEAD it
 * was pinned at. A commit made onto the detached snapshot after the scan is on no
 * ref, so without this `git worktree remove` deleted its only checkout.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FRESH_SNAPSHOT_COMMIT_MESSAGE, FRESH_SNAPSHOT_MIN_AGE_MS } from "../../../../worktree/freshSnapshotPath.js";
import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { realGit } from "../../../../worktree/pruneGit.js";
import { changedSinceScan, PINNED_SNAPSHOT, pinSnapshot } from "../../../../worktree/pruneRecheck.js";
import { activityNowMs } from "../../../../worktree/pruneScan.js";
import { privateHistoryWithinHead } from "../../../../worktree/snapshotPrivateHistory.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

/**
 * Add a linked tree detached at the snapshot code's own synthetic commit, made as `snapshotCommit` makes it: with
 * `commit-tree` over the repository's HEAD, so the tree's private gitdir holds only what a real snapshot's does —
 * `git commit` would add a `COMMIT_EDITMSG` no snapshot carries.
 *
 * @returns the snapshot commit the tree is checked out at
 */
function addSnapshotTree({ repo, path }: { repo: string; path: string }): string {
  const sha = gitInTemp({
    args: [
      "-c",
      "user.email=a@b.c",
      "-c",
      "user.name=t",
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      FRESH_SNAPSHOT_COMMIT_MESSAGE,
    ],
    cwd: repo,
  });
  gitInTemp({ args: ["worktree", "add", "-q", "--detach", path, sha], cwd: repo });
  return sha;
}

/** A repository with a linked detached worktree shaped like a one-off snapshot, and its `snapshot` verdict. */
function seedSnapshot(): { repo: string; verdict: PruneVerdict } {
  const repo = seedRepo();
  const path = join(dir, "slopweaver-snap-AbC123", "tree");
  const scannedHead = addSnapshotTree({ path, repo });
  const verdict: PruneVerdict = {
    ...verdictFor({ path }),
    branch: null,
    cls: "snapshot",
    dropsDeps: false,
    scannedHead,
  };
  return { repo, verdict };
}

/** An instant long past any age the tree could read, so only the HEAD check can keep it. */
const LONG_AFTER_MS = Date.UTC(2100, 0, 1);

/** Commit one new file onto the snapshot's detached HEAD — the r1 counterexample's C1. */
function commitOnto({ path }: { path: string }): void {
  writeFileSync(join(path, "only-here.txt"), "work on no ref\n");
  gitInTemp({ args: ["add", "-A"], cwd: path });
  gitInTemp({ args: [...COMMIT, "c1"], cwd: path });
}

/**
 * Commit onto the snapshot, then check the scanned HEAD back out — a move that leaves `ORIG_HEAD` where it was.
 *
 * `git commit` also writes `COMMIT_EDITMSG`, which alone keeps the tree (a file no snapshot carries); a commit made
 * by plumbing writes none, so it is removed here to leave only the mechanism each test is about.
 *
 * @returns the commit left behind
 */
function commitThenLeave({ path, scannedHead }: { path: string; scannedHead: string }): string {
  commitOnto({ path });
  const left = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: path });
  gitInTemp({ args: ["checkout", "-q", "--detach", scannedHead], cwd: path });
  rmSync(join(gitInTemp({ args: ["rev-parse", "--absolute-git-dir"], cwd: path }), "COMMIT_EDITMSG"));
  return left;
}

/** Empty the tree's own HEAD reflog, the counterexample's last step. */
function expireHeadReflog({ path }: { path: string }): void {
  gitInTemp({ args: ["reflog", "expire", "--expire=now", "--expire-unreachable=now", "HEAD"], cwd: path });
}

const MOVED = "its HEAD is not the one the scan read — a commit since, however dated, kept it";
const PRIVATE_HISTORY = "its own gitdir names a commit its HEAD does not contain, or could not be read — kept";

describe("a one-off snapshot's removal re-reads it", REAL_GIT_SUITE, () => {
  it("keeps a snapshot committed onto since the scan", () => {
    const { repo, verdict } = seedSnapshot();
    commitOnto({ path: verdict.path });

    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(MOVED);
    expect(existsSync(join(verdict.path, "only-here.txt"))).toBe(true);
  });

  it("keeps a snapshot committed onto since the scan even when every date it carries reads cold", () => {
    const { repo, verdict } = seedSnapshot();
    commitOnto({ path: verdict.path });

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: MOVED });
  });

  it("keeps a snapshot whose scanned HEAD is a commit made between the scan's two reads, not the snapshot's own", () => {
    const { repo, verdict } = seedSnapshot();
    commitOnto({ path: verdict.path });
    // The race: provenance read at S, then HEAD read at C, so the verdict pins C.
    const raced = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

    expect(pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: raced })).toEqual({
      declined: "its HEAD is not the snapshot code's own commit — kept for the ordinary rules",
    });
  });

  it("keeps a snapshot whose verdict carries no scanned HEAD to pin", () => {
    const { repo, verdict } = seedSnapshot();

    expect(pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: undefined })).toEqual({
      declined: MOVED,
    });
  });

  it("keeps a snapshot at its scanned HEAD that reads warm at removal", () => {
    const { repo, verdict } = seedSnapshot();
    const activity = activityNowMs({ path: verdict.path })!;

    expect(
      pinSnapshot({ nowMs: activity, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: "it was touched since the scan, inside the longest Codex pass — kept" });
  });

  it("pins the scanned HEAD of a snapshot still cold at removal, kept under a shared local ref", () => {
    const { repo, verdict } = seedSnapshot();
    const activity = activityNowMs({ path: verdict.path })!;

    expect(
      pinSnapshot({
        nowMs: activity + FRESH_SNAPSHOT_MIN_AGE_MS,
        path: verdict.path,
        repoRoot: repo,
        scannedHead: verdict.scannedHead,
      }),
    ).toEqual({ headSha: verdict.scannedHead });
    expect(gitInTemp({ args: ["rev-parse", `${PINNED_SNAPSHOT}${verdict.scannedHead!}`], cwd: repo })).toBe(
      verdict.scannedHead,
    );
  });

  it("keeps the frozen-from commit reachable after the removal, though its only branch went in between", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["checkout", "-q", "-b", "wip"], cwd: repo });
    writeFileSync(join(repo, "wip.txt"), "committed, never pushed\n");
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "wip"], cwd: repo });
    const parent = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    const path = join(dir, "slopweaver-snap-WiP456", "tree");
    const scannedHead = addSnapshotTree({ path, repo });
    expect(pinSnapshot({ nowMs: LONG_AFTER_MS, path, repoRoot: repo, scannedHead })).toEqual({ headSha: scannedHead });
    // The race: the one branch carrying the parent goes after the witness read and before the removal.
    gitInTemp({ args: ["checkout", "-q", "main"], cwd: repo });
    gitInTemp({ args: ["branch", "-q", "-D", "wip"], cwd: repo });
    gitInTemp({ args: ["worktree", "remove", path], cwd: repo });
    expect(existsSync(path)).toBe(false);
    expect(gitInTemp({ args: ["for-each-ref", "--contains", parent, "--format=%(refname)"], cwd: repo })).toBe(
      `${PINNED_SNAPSHOT}${scannedHead}`,
    );
  });

  it("keeps a snapshot back at its scanned HEAD whose reflog alone holds a commit moved away from", () => {
    const { repo, verdict } = seedSnapshot();
    const movedAway = commitThenLeave({ path: verdict.path, scannedHead: verdict.scannedHead! });
    // The witness half: the tree is back at the scanned HEAD and only its reflog names the commit — `ORIG_HEAD` is
    // still where `git worktree add` left it, within the scanned HEAD's history as every real snapshot's is.
    expect(gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path })).toBe(verdict.scannedHead);
    expect(gitInTemp({ args: ["reflog", "show", "--format=%H", "HEAD", "--"], cwd: verdict.path })).toContain(
      movedAway,
    );
    expect([
      verdict.scannedHead,
      gitInTemp({ args: ["rev-parse", `${verdict.scannedHead!}^`], cwd: verdict.path }),
    ]).toContain(gitInTemp({ args: ["rev-parse", "ORIG_HEAD"], cwd: verdict.path }));

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("keeps a snapshot whose per-worktree ref alone holds a commit, its reflog expired", () => {
    const { repo, verdict } = seedSnapshot();
    const kept = commitThenLeave({ path: verdict.path, scannedHead: verdict.scannedHead! });
    gitInTemp({ args: ["update-ref", "refs/bisect/keep", kept], cwd: verdict.path });
    expireHeadReflog({ path: verdict.path });
    // The witness half: nothing but `refs/bisect/keep`, which lives in the tree's own gitdir, names the commit.
    expect(gitInTemp({ args: ["reflog", "show", "--format=%H", "HEAD", "--"], cwd: verdict.path })).toBe("");
    expect(gitInTemp({ args: ["for-each-ref", "--contains", kept, "--format=%(refname)"], cwd: verdict.path })).toBe(
      "refs/bisect/keep",
    );
    expect(gitInTemp({ args: ["for-each-ref", "--contains", kept, "--format=%(refname)"], cwd: repo })).toBe("");

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("keeps a snapshot whose ORIG_HEAD alone holds a commit reset away, its reflog expired", () => {
    const { repo, verdict } = seedSnapshot();
    commitOnto({ path: verdict.path });
    const resetAway = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });
    gitInTemp({ args: ["reset", "-q", "--hard", verdict.scannedHead!], cwd: verdict.path });
    expireHeadReflog({ path: verdict.path });
    // The witness half: the reflog is empty, and the reset left ORIG_HEAD on the commit it took away.
    expect(gitInTemp({ args: ["reflog", "show", "--format=%H", "HEAD", "--"], cwd: verdict.path })).toBe("");
    expect(gitInTemp({ args: ["rev-parse", "ORIG_HEAD"], cwd: verdict.path })).toBe(resetAway);

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("refuses a snapshot whose index alone holds a blob staged since, its status read aside", () => {
    const { verdict } = seedSnapshot();
    writeFileSync(join(verdict.path, "staged-only.txt"), "on no commit\n");
    gitInTemp({ args: ["add", "staged-only.txt"], cwd: verdict.path });
    // The witness half: the blob is in the index and in no commit, and no resolve-undo record names anything.
    expect(gitInTemp({ args: ["diff", "--cached", "--name-only"], cwd: verdict.path })).toBe("staged-only.txt");
    expect(gitInTemp({ args: ["ls-files", "--resolve-undo"], cwd: verdict.path })).toBe("");

    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: verdict.scannedHead! })).toBe(false);
  });

  it("refuses a snapshot whose index alone holds a staged gitlink its submodule config ignores", () => {
    const { repo, verdict } = seedSnapshot();
    const base = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    // A HEAD whose tree carries gitlink `sub` at the base commit — the counterexample's `sub=A`.
    gitInTemp({ args: ["update-index", "--add", "--cacheinfo", `160000,${base},sub`], cwd: verdict.path });
    const tree = gitInTemp({ args: ["write-tree"], cwd: verdict.path });
    const head = gitInTemp({
      args: ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit-tree", tree, "-p", verdict.scannedHead!, "-m", "x"],
      cwd: verdict.path,
    });
    gitInTemp({ args: ["checkout", "-q", "--detach", head], cwd: verdict.path });
    // `submodule.<name>.ignore` reaches a path only through `.gitmodules`, which names the path's submodule.
    writeFileSync(join(verdict.path, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n');
    gitInTemp({ args: ["config", "submodule.sub.ignore", "all"], cwd: repo });
    gitInTemp({ args: ["update-index", "--cacheinfo", `160000,${verdict.scannedHead!},sub`], cwd: verdict.path });
    // The witness half: the index names another commit at `sub`, and the diff the ignore config governs hides it.
    expect(gitInTemp({ args: ["ls-files", "-s", "sub"], cwd: verdict.path })).toContain(verdict.scannedHead!);
    expect(gitInTemp({ args: ["diff-index", "--cached", "--name-only", "HEAD", "--"], cwd: verdict.path })).toBe("");

    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: head })).toBe(false);
  });

  it("refuses a repository whose shared info/grafts gc would honour, though the real history contains the name", () => {
    const { repo, verdict } = seedSnapshot();
    const parent = gitInTemp({ args: ["rev-parse", `${verdict.scannedHead!}^`], cwd: verdict.path });
    gitInTemp({ args: ["update-ref", "ORIG_HEAD", parent], cwd: verdict.path });
    expireHeadReflog({ path: verdict.path });
    // The witness half: without the grafts file the same tree passes, so the file is what refuses it.
    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: verdict.scannedHead! })).toBe(true);
    const common = gitInTemp({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: repo });
    mkdirSync(join(common, "info"), { recursive: true });
    writeFileSync(join(common, "info", "grafts"), `${verdict.scannedHead!}\n`);

    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: verdict.scannedHead! })).toBe(false);
  });

  it("finds the grafts file of a repository whose gitdir name ends in a space", () => {
    const common = join(dir, "common.git ");
    gitInTemp({ args: ["clone", "-q", "--bare", seedRepo(), common], cwd: dir });
    const path = join(dir, "spaced-tree");
    gitInTemp({ args: ["worktree", "add", "-q", "--detach", path, "HEAD"], cwd: common });
    const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: path });
    // The witness half: the same tree passes until the grafts file, inside the space-ended gitdir, is there.
    expect(privateHistoryWithinHead({ git: realGit, path, rev: head })).toBe(true);
    mkdirSync(join(common, "info"), { recursive: true });
    writeFileSync(join(common, "info", "grafts"), `${head}\n`);

    expect(privateHistoryWithinHead({ git: realGit, path, rev: head })).toBe(false);
  });

  it("refuses a repository a replace graft rewrote, whichever history the name sits in", () => {
    const { repo, verdict } = seedSnapshot();
    // A divergent root commit on no ref, named only by the tree's private ORIG_HEAD — the counterexample's X.
    const divergent = gitInTemp({
      args: ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit-tree", "HEAD^{tree}", "-m", "x"],
      cwd: verdict.path,
    });
    gitInTemp({ args: ["update-ref", "ORIG_HEAD", divergent], cwd: verdict.path });
    expireHeadReflog({ path: verdict.path });
    gitInTemp({ args: ["replace", "--graft", verdict.scannedHead!, divergent], cwd: repo });
    // The witness half: through the graft, the divergent commit now reads as the scanned HEAD's own parent.
    expect(gitInTemp({ args: ["rev-parse", `${verdict.scannedHead!}^`], cwd: verdict.path })).toBe(divergent);

    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: verdict.scannedHead! })).toBe(false);
  });

  it("refuses an annotated tag object only the private ORIG_HEAD names, though it peels to the scanned HEAD", () => {
    const { repo, verdict } = seedSnapshot();
    gitInTemp({
      args: ["-c", "user.email=a@b.c", "-c", "user.name=t", "tag", "-a", "only-here", "-m", "x", verdict.scannedHead!],
      cwd: repo,
    });
    const tag = gitInTemp({ args: ["rev-parse", "refs/tags/only-here"], cwd: repo });
    gitInTemp({ args: ["tag", "-d", "only-here"], cwd: repo });
    gitInTemp({ args: ["update-ref", "ORIG_HEAD", tag], cwd: verdict.path });
    expireHeadReflog({ path: verdict.path });
    // The witness half: the id is a tag object on no ref, and merge-base alone peels it into the scanned HEAD's history.
    expect(gitInTemp({ args: ["cat-file", "-t", tag], cwd: verdict.path })).toBe("tag");
    expect(gitInTemp({ args: ["for-each-ref", "--points-at", verdict.scannedHead!, "refs/tags/"], cwd: repo })).toBe(
      "",
    );
    expect(gitInTemp({ args: ["merge-base", "--is-ancestor", tag, verdict.scannedHead!], cwd: verdict.path })).toBe("");

    expect(privateHistoryWithinHead({ git: realGit, path: verdict.path, rev: verdict.scannedHead! })).toBe(false);
  });

  it("keeps a snapshot whose FETCH_HEAD names a commit on its second line alone, its reflog expired", () => {
    const { repo, verdict } = seedSnapshot();
    const fetched = commitThenLeave({ path: verdict.path, scannedHead: verdict.scannedHead! });
    expireHeadReflog({ path: verdict.path });
    const parent = gitInTemp({ args: ["rev-parse", `${verdict.scannedHead!}^`], cwd: verdict.path });
    const fetchHead = gitInTemp({
      args: ["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD"],
      cwd: verdict.path,
    });
    // A fetch of two refs, the second since deleted upstream: `rev-parse FETCH_HEAD` reads only the first line.
    writeFileSync(
      fetchHead,
      `${parent}\t\tbranch 'main' of ${repo}\n${fetched}\tnot-for-merge\tbranch 'gone' of ${repo}\n`,
    );
    expect(gitInTemp({ args: ["rev-parse", "FETCH_HEAD"], cwd: verdict.path })).toBe(parent);
    expect(gitInTemp({ args: ["reflog", "show", "--format=%H", "HEAD", "--"], cwd: verdict.path })).toBe("");

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("keeps a snapshot whose reflog names a commit only on the side HEAD moved away from", () => {
    const { repo, verdict } = seedSnapshot();
    commitOnto({ path: verdict.path });
    const movedFrom = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });
    gitInTemp({ args: ["reset", "-q", "--hard", verdict.scannedHead!], cwd: verdict.path });
    // The entry that moved HEAD TO the commit goes; the reset's entry, which moved HEAD FROM it, stays.
    gitInTemp({ args: ["reflog", "delete", "HEAD@{1}"], cwd: verdict.path });
    const parent = gitInTemp({ args: ["rev-parse", `${verdict.scannedHead!}^`], cwd: verdict.path });
    gitInTemp({ args: ["update-ref", "ORIG_HEAD", parent], cwd: verdict.path });
    // The witness half: `reflog show` no longer prints the commit, yet the raw reflog still names it.
    expect(gitInTemp({ args: ["reflog", "show", "--format=%H", "HEAD", "--"], cwd: verdict.path })).not.toContain(
      movedFrom,
    );
    const rawLog = gitInTemp({
      args: ["rev-parse", "--path-format=absolute", "--git-path", "logs/HEAD"],
      cwd: verdict.path,
    });
    expect(readFileSync(rawLog, "utf8")).toContain(`${movedFrom} ${verdict.scannedHead!}`);

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("keeps a clean snapshot whose index alone keeps a resolved conflict's sides", () => {
    const { repo, verdict } = seedSnapshot();
    const side = ({ text }: { text: string }): string =>
      gitInTemp({ args: ["hash-object", "-w", "--stdin"], cwd: verdict.path, input: text });
    const ours = side({ text: "only in the index, ours\n" });
    const theirs = side({ text: "only in the index, theirs\n" });
    gitInTemp({
      args: ["update-index", "--index-info"],
      cwd: verdict.path,
      input: `100644 ${ours} 2\tconflict.txt\n100644 ${theirs} 3\tconflict.txt\n`,
    });
    // Resolved by dropping the path, so the index matches HEAD again and only resolve-undo names the two sides.
    gitInTemp({ args: ["rm", "-q", "--cached", "conflict.txt"], cwd: verdict.path });
    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("");
    expect(gitInTemp({ args: ["ls-files", "--resolve-undo"], cwd: verdict.path })).toContain(ours);

    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ declined: PRIVATE_HISTORY });
  });

  it("keeps a snapshot whose per-worktree ref took a commit after its pin, read again before git removes", () => {
    const { repo, verdict } = seedSnapshot();
    // A commit outside the snapshot's history, carried for now by a shared branch.
    gitInTemp({ args: ["checkout", "-q", "-b", "temp"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "c-elsewhere", "--allow-empty"], cwd: repo });
    const elsewhere = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    gitInTemp({ args: ["checkout", "-q", "main"], cwd: repo });
    expect(
      pinSnapshot({ nowMs: LONG_AFTER_MS, path: verdict.path, repoRoot: repo, scannedHead: verdict.scannedHead }),
    ).toEqual({ headSha: verdict.scannedHead });
    // The witness half: clean and unmoved after the pin, the last re-read passes.
    expect(changedSinceScan({ pinnedHead: verdict.scannedHead!, verdict })).toBeNull();
    // Between the pin and the removal: the tree's own ref takes the commit, and its only branch goes.
    gitInTemp({ args: ["update-ref", "refs/bisect/keep", elsewhere], cwd: verdict.path });
    gitInTemp({ args: ["branch", "-q", "-D", "temp"], cwd: repo });

    expect(changedSinceScan({ pinnedHead: verdict.scannedHead!, verdict })).toBe(
      "its own gitdir names a commit its HEAD does not contain, or could not be read, since the pin — kept",
    );
  });

  it("keeps a snapshot committed onto after its pin, whatever its age read", () => {
    const { verdict } = seedSnapshot();
    const pinnedHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });
    commitOnto({ path: verdict.path });

    // The private-history read catches it before the HEAD read can: the moved HEAD is written into the tree's own
    // gitdir, as its `HEAD` file and its reflog, and the new commit is not in the pinned HEAD's history.
    expect(changedSinceScan({ pinnedHead, verdict })).toBe(
      "its own gitdir names a commit its HEAD does not contain, or could not be read, since the pin — kept",
    );
  });

  it("keeps a snapshot whose HEAD cannot be read at all", () => {
    expect(pinSnapshot({ nowMs: 0, path: join(dir, "no-such-tree"), repoRoot: dir, scannedHead: "abc123" })).toEqual({
      declined: "its HEAD could not be read before removal — kept",
    });
  });
});
