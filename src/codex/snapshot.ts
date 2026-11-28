/**
 * A frozen copy of the tree, so a pass reads code that cannot move under it.
 *
 * {@link createTreeSnapshot} here is the FRESH copy — a whole checkout minted and deleted per pass. A pass
 * leases a pooled one first (`./snapshotPool.ts`), which writes only what changed, and falls back to this one.
 *
 * ## The problem this replaces
 *
 * On the PR6 build a pre-mortem was launched and the implementation began sixty-six seconds later. By the
 * time the pass returned it described files that no longer existed, and its findings arrived as rework
 * rather than as design input. The obvious remedy — forbid writing while a pass runs — is worse than the
 * disease: measured on the same project, an agent waiting on a 21-minute sweep found a real defect in
 * ninety seconds. Blocking that is a real cost, and filesystem-level enforcement brings its own failures.
 *
 * So nothing is forbidden. The pass reads a snapshot instead, the agent keeps working, and neither can
 * affect the other. Waiting stops being a rule anyone has to remember.
 *
 * ## Why a scratch index rather than `git stash create`
 *
 * `stash create` is the one-line version and it silently omits UNTRACKED files. Measured against a real
 * repository: a new file was absent from the resulting commit. A branch whose change is mostly new source —
 * which is most of them — would snapshot to something that barely resembles the tree, and a review of it
 * would be a review of code nobody wrote.
 *
 * Staging into a scratch index gets tracked and untracked alike while leaving the caller's index, working
 * tree and stash list completely untouched. `.gitignore` still applies, so build output stays out.
 *
 * ## What "frozen copy" does and does not promise
 *
 * Both limits below were found by a review pass of this file and then reproduced, and both were overstated
 * in an earlier version of this header.
 *
 * **It holds git's CANONICAL content, not raw working-tree bytes.** Staging applies whatever clean filters
 * the repository configures, so a `.gitattributes` carrying `*.txt text eol=lf` turns a working-tree
 * `changed\r\n` into `changed\n` in the copy — measured, not theorised. That is the content git itself would
 * check out, and reviewing it is defensible; claiming byte-identity with the working tree is not.
 *
 * **The caller's repository is not entirely untouched.** Its index, working tree, stash list and refs are.
 * But `git worktree add` registers a linked worktree under `.git/worktrees` (removed on release, and
 * `git worktree prune` collects any that leak), `commit-tree` writes an object that survives release until
 * the next `git gc`, and every `git add -A` through a scratch index — {@link captureContentTree}'s included,
 * which writes objects with no commit at all — writes a loose blob per changed or untracked file. All of them
 * are invisible to any normal operation and none is reachable from a ref — which is a much narrower claim
 * than "untouched" and is the true one.
 *
 * The snapshot commit is written with `commit-tree`, which is unreachable from any ref, so it costs nothing
 * and disappears with the next `git gc`. Nothing is added to the caller's history.
 *
 * ## How a caller asks whether the copy holds what the live tree holds
 *
 * Not by fingerprinting this worktree. A fingerprint (`./fingerprint.ts`) is a digest over `(HEAD^{tree}, the
 * patch against HEAD)`, and inside the copy HEAD IS the snapshot commit and the patch is empty — so the copy
 * digests `(contentTree, "")` while the live repository digests `(HEAD^{tree}, the dirty patch)`. Those two can
 * only agree on a clean tree, which made the comparison unsatisfiable on every dirty one. MEASURED;
 * the numbers are on {@link TreeSnapshot.contentTree}.
 *
 * So the copy reports `contentTree`, and {@link captureContentTree} takes the same address of the live tree.
 * Both sides are then git's own content address of the same thing, which holds dirty or clean.
 *
 * ## Why the OS temp directory rather than `$SLOPWEAVER_HOME`
 *
 * Every other local-state writer here lives under `$SLOPWEAVER_HOME`, and this one deliberately does not.
 * The tripwire treats a pass reading the orchestration tree as drift — there is nothing in another pass's
 * directory but old verdicts, so it is a reliable "lost the task" signal. Putting a snapshot there would
 * make every pass trip that signal by reading its own working copy. The two mechanisms have to live in
 * different places to both stay honest.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { FRESH_SNAPSHOT_COMMIT_MESSAGE, FRESH_SNAPSHOT_PREFIX } from "../worktree/freshSnapshotPath.js";
import { GIT_TREE_WRITE_TIMEOUT_MS, runGitChecked } from "./gitRun.js";

/** A frozen tree, and the means to let it go. */
export interface TreeSnapshot {
  /** The absolute path a pass should read INSTEAD of the live repository. */
  readonly path: string;
  /** The unreachable commit the worktree points at, recorded so the artifact can state what was read. */
  readonly commit: string;
  /**
   * Git's own content address of what this copy HOLDS — the `write-tree` output {@link snapshotCommit} builds
   * the commit from, kept rather than discarded.
   *
   * This is the only value a caller can compare against the LIVE tree, and the reason it exists is a measured
   * defect. A fingerprint taken inside this worktree is over `(HEAD^{tree}, "")`, because HEAD here IS the
   * snapshot commit and the worktree is clean — while a fingerprint of the live repository is over
   * `(HEAD^{tree}, the dirty patch)`. Those agree only on a clean tree, so comparing them rejected every
   * dirty one by construction. MEASURED in a throwaway repo: clean, both read the same digest
   * over one tree; one edit later, the live read (that tree + 333 dirty bytes) differs from the copy's
   * (a different content tree + 0). Repro:
   * `captureTreeFingerprint` against a repo and against this `path`, before and after one edit.
   *
   * Compared against {@link captureContentTree} of the live tree it holds on a dirty tree too, because both
   * sides are git's own content address of the same thing.
   */
  readonly contentTree: string;
  /**
   * The pool directory this snapshot's own acquire computed and leased from, present only on a pooled snapshot
   * (`./snapshotPool.ts`); a fresh one has none. It is the ONLY authority for removing a pool: a description
   * review removes the one-shot pool its packet repository minted from this value, never from a path it
   * rebuilt or found by listing (`./snapshotPoolReclaim.ts`).
   */
  readonly poolRoot?: string;
  /**
   * Let the snapshot go: a fresh one ({@link createTreeSnapshot}) is removed, a pooled one
   * (`./snapshotPool.ts`) returns its lease and keeps its tree for the next pass, until a description review
   * removes its own one-shot pool once every pass has finished. Safe to call more than once,
   * and never throws.
   *
   * Cleanup that can fail a pass would make the snapshot a liability: the verdict is already computed by the
   * time this runs, and losing it because a directory would not delete is a strictly worse outcome than a
   * leftover directory the next `git worktree prune` collects.
   */
  readonly release: () => void;
}

/**
 * Freeze the current tree — tracked, staged and untracked — and check it out somewhere a pass can read.
 *
 * @param repoRoot the repository to snapshot
 * @param stagingParent directory each staging directory is minted under — defaults to the OS temp dir; a
 *   test passes its own `mkdtemp` root here so it can enumerate what IT produced without scanning the whole
 *   shared temp directory
 * @returns the snapshot, or a typed io error when git refused
 */
export function createTreeSnapshot({
  repoRoot,
  stagingParent = tmpdir(),
}: {
  repoRoot: string;
  stagingParent?: string;
}): Result<TreeSnapshot, IngestError> {
  return safeFs({
    execute: (): TreeSnapshot => {
      // The prefix `worktree prune` recognises a leaked one by (`../worktree/freshSnapshotPath.ts`).
      const staging = mkdtempSync(join(stagingParent, FRESH_SNAPSHOT_PREFIX));
      try {
        const indexFile = join(staging, "index");
        const { commit, contentTree } = snapshotCommit({ indexFile, repoRoot });
        const path = join(staging, "tree");
        try {
          runGitChecked({
            args: [...snapshotGitPrefix({ staging }), "worktree", "add", "--detach", "-q", path, commit],
            cwd: repoRoot,
            label: "git worktree add",
            timeoutMs: GIT_TREE_WRITE_TIMEOUT_MS,
          });
        } catch (error) {
          // git clears a half-built worktree itself when CHECKOUT fails, but not one that completed before the
          // add reported failure — a post-checkout hook's exit status was exactly that, 42 times over. The outer
          // catch deletes the directory, so deregister it here or the registration outlives the attempt.
          releaseSnapshot({ path, repoRoot, staging });
          throw error;
        }
        let released = false;
        return {
          commit,
          contentTree,
          path,
          release: () => {
            // Guarded, not merely tolerant of a second call. Release deletes `staging` recursively BY NAME,
            // so a second call after something else recreated that path would delete the replacement. A
            // temp directory name can be reused, and "safe to call twice" must not mean "deletes whatever
            // is there the second time".
            if (released) {
              return;
            }
            released = true;
            releaseSnapshot({ path, repoRoot, staging });
          },
        };
      } catch (error) {
        // `staging` is minted before git ever runs. If `repoRoot` is not a repository, or any other git step
        // here fails, there is no `TreeSnapshot` to call `release()` on — so without this, a failed attempt
        // left its staging directory under the OS temp dir forever, one per failure.
        rmSync(staging, { force: true, recursive: true });
        throw error;
      }
    },
    operation: "codex.createTreeSnapshot",
    path: repoRoot,
  });
}

/**
 * Git's own content address of a working tree, tracked and untracked alike, taken through a scratch index.
 *
 * The ONE implementation of that address, shared by {@link snapshotCommit} and {@link captureContentTree}, so
 * the value a frozen copy reports and the value the live tree reports cannot drift apart. A second copy of
 * this three-command sequence is precisely the shape that once left four independent `tsToIso` functions
 * standing in this tree with no single function a rule could name.
 *
 * Two properties are load-bearing and neither is incidental:
 *
 * **`GIT_INDEX_FILE` is passed explicitly rather than inherited** — {@link runGitChecked} strips the
 * environment first, and this adds back only the one variable, which is the difference between a controlled
 * override and the accidental inheritance the stripping exists to prevent.
 *
 * **The scratch index is built fresh from `read-tree HEAD`, so it carries no skip-worktree or assume-unchanged
 * bits at all** — those live in the caller's index, not in HEAD. So `git add -A` here stages the real
 * working-tree content of a path `git diff` refuses to report, and this address has none of the blindness
 * `hiddenPathsText` (`./hiddenPaths.ts`) exists to patch over. MEASURED:
 *
 * ```bash
 * git init -q && printf "one\\n" > a.txt && git add -A && git commit -qm seed   # the sha below needs this seed
 * git update-index --skip-worktree a.txt && printf "EDITED\\n" > a.txt
 * git diff HEAD                                    # prints nothing
 * GIT_INDEX_FILE=$X git read-tree HEAD && GIT_INDEX_FILE=$X git add -A -- . && GIT_INDEX_FILE=$X git write-tree
 * # <tree-sha> — and the same value once the flag is cleared
 * ```
 *
 * `seedIndex` is the one deliberate exception to that second property: {@link captureStagedContentTree} seeds
 * the scratch index from a COPY of the caller's own, flags and staged state included, because what it
 * predicts is what the caller's own `git add --all` would stage — which honours those flags.
 */
function contentTreeSha({
  indexFile,
  repoRoot,
  seedIndex,
}: {
  indexFile: string;
  repoRoot: string;
  /**
   * The index file to copy as the starting point (an empty index when that file is absent), or undefined to
   * build it fresh from `read-tree HEAD`.
   */
  seedIndex: string | undefined;
}): string {
  const env = { GIT_INDEX_FILE: indexFile };
  const off = snapshotGitPrefix({ staging: dirname(indexFile) });
  if (seedIndex === undefined) {
    runGitChecked({ args: [...off, "read-tree", "HEAD"], cwd: repoRoot, extraEnv: env, label: "git read-tree" });
  } else if (existsSync(seedIndex)) {
    copyFileSync(seedIndex, indexFile);
  }
  // A caller with no index file at all is a state git recovers from: its own `add -A` starts from an empty
  // index, so the scratch one is left absent to start from the same nothing.
  // `-A` from the repository root, so the set is the whole tree rather than whatever cwd happens to be.
  runGitChecked({
    args: [...off, "add", "-A", "--", "."],
    cwd: repoRoot,
    extraEnv: env,
    label: "git add (scratch index)",
  });
  return runGitChecked({ args: [...off, "write-tree"], cwd: repoRoot, extraEnv: env, label: "git write-tree" }).trim();
}

/**
 * Take git's content address of the LIVE tree, so it can be compared with what a frozen copy holds.
 *
 * The comparable half of {@link TreeSnapshot.contentTree}, and the reason a pass run from a DIRTY checkout can
 * record provenance at all. The scratch index is minted outside `repoRoot` on purpose: written inside it, the
 * very next `git add -A` stages the index file itself and two identical trees address differently — measured
 * while building this, and the kind of mistake that looks like a git subtlety rather than a bug in the caller.
 *
 * @param repoRoot the repository whose working tree should be addressed
 * @param stagingParent directory the scratch index is minted under — defaults to the OS temp dir, and never
 *   `repoRoot`; a test passes its own `mkdtemp` root so it can enumerate what IT produced
 * @returns the content tree sha, or a typed io error when git refused
 */
export function captureContentTree({
  repoRoot,
  stagingParent = tmpdir(),
}: {
  repoRoot: string;
  stagingParent?: string;
}): Result<string, IngestError> {
  return safeFs({
    execute: (): string => {
      const staging = mkdtempSync(join(stagingParent, "slopweaver-content-"));
      try {
        return contentTreeSha({ indexFile: join(staging, "index"), repoRoot, seedIndex: undefined });
      } finally {
        rmSync(staging, { force: true, recursive: true });
      }
    },
    operation: "codex.captureContentTree",
    path: repoRoot,
  });
}

/**
 * Take the tree the caller's own `git add --all` WOULD stage right now, without staging anything.
 *
 * `github stack push` pins this before its gates and lock wait, and refuses to amend unless the tree its real
 * `add --all` stages later is the same one — so an edit made while it runs cannot ride into the commit. The
 * scratch index starts as a copy of the caller's index rather than `read-tree HEAD`, so staged state,
 * intent-to-add entries and skip-worktree bits are carried exactly as the real add will meet them; a
 * comparison against a HEAD-seeded tree would disagree on every skip-worktree path.
 *
 * @param repoRoot the repository whose next `git add --all` should be predicted
 * @param stagingParent directory the scratch index is minted under — defaults to the OS temp dir, and never
 *   `repoRoot`, for the reason {@link captureContentTree} gives
 * @returns the tree sha, or a typed io error when git refused or the caller's index could not be read
 */
export function captureStagedContentTree({
  repoRoot,
  stagingParent = tmpdir(),
}: {
  repoRoot: string;
  stagingParent?: string;
}): Result<string, IngestError> {
  return safeFs({
    execute: (): string => {
      const seedIndex = runGitChecked({
        args: ["rev-parse", "--path-format=absolute", "--git-path", "index"],
        cwd: repoRoot,
        label: "git rev-parse --git-path index",
      }).trim();
      const staging = mkdtempSync(join(stagingParent, "slopweaver-staged-"));
      try {
        return contentTreeSha({ indexFile: join(staging, "index"), repoRoot, seedIndex });
      } finally {
        rmSync(staging, { force: true, recursive: true });
      }
    },
    operation: "codex.captureStagedContentTree",
    path: repoRoot,
  });
}

/**
 * Build a commit holding the tree exactly as it stands, and keep the content address it was built from.
 *
 * The `write-tree` output used to be a local that `commit-tree` consumed and nothing else ever saw. Returning
 * it is what makes the frozen copy comparable to the live tree on a dirty checkout — see
 * {@link TreeSnapshot.contentTree} for the measurement that forced it. Exported for `./snapshotPool.ts`, so the
 * pooled copy is built by the same sequence rather than a second one.
 *
 * @param indexFile the scratch index to stage through — its directory is also where the hooks path points
 * @param repoRoot the repository to snapshot
 * @returns the unreachable snapshot commit and the content tree it was built from
 */
export function snapshotCommit({ indexFile, repoRoot }: { indexFile: string; repoRoot: string }): {
  readonly commit: string;
  readonly contentTree: string;
} {
  const contentTree = contentTreeSha({ indexFile, repoRoot, seedIndex: undefined });
  const commit = runGitChecked({
    args: [
      ...snapshotGitPrefix({ staging: dirname(indexFile) }),
      "commit-tree",
      contentTree,
      "-p",
      "HEAD",
      "-m",
      FRESH_SNAPSHOT_COMMIT_MESSAGE,
    ],
    cwd: repoRoot,
    label: "git commit-tree",
  }).trim();
  return { commit, contentTree };
}

/**
 * The `-c` prefix that stops a git invocation here running any repository hook, pointed at a path under the
 * staging directory that nothing creates — the same shape `github/restackExec.ts` uses for its scratch tree.
 * EVERY invocation carries it, not only the add: `read-tree` and `add -A` fire `post-index-change`.
 * A snapshot is a read, and a hook is the repository acting on a checkout that is not a real one. A
 * configured `core.fsmonitor` is an executable git runs the same way, so it is switched off too.
 *
 * This repository's `post-checkout` hook runs `node_modules/.bin/tsx`, which a fresh checkout does not have,
 * and git hands the hook's exit status back as `worktree add`'s own. So every snapshot failed: MEASURED,
 * the add exits 1 with hooks and 0 without, and 42 registrations under `.git/worktrees` pointed at
 * deleted staging directories while each plan pass silently read the live tree instead. Repro, from any
 * checkout of this repository:
 *
 *   git worktree add --detach -q "$(mktemp -d)/t" HEAD; echo $?
 *
 * Exported for `./snapshotPool.ts`, whose every git call against a slot carries it too.
 *
 * @param staging a directory this snapshot owns; the hooks path points at a child of it nothing creates
 * @returns the `-c` arguments to put before the git subcommand
 */
export function snapshotGitPrefix({ staging }: { staging: string }): readonly string[] {
  return ["-c", `core.hooksPath=${join(staging, ".slopweaver-no-hooks")}`, "-c", "core.fsmonitor=false"];
}

/**
 * Detach the worktree and delete the staging directory, swallowing every failure. `--force` TWICE: git refuses a
 * LOCKED worktree to a single one, and the staging directory is deleted either way, so a lock would strand the
 * registration.
 */
function releaseSnapshot({ path, repoRoot, staging }: { path: string; repoRoot: string; staging: string }): void {
  try {
    runGitChecked({
      args: [...snapshotGitPrefix({ staging }), "worktree", "remove", "--force", "--force", path],
      cwd: repoRoot,
      label: "git worktree remove",
      timeoutMs: GIT_TREE_WRITE_TIMEOUT_MS,
    });
  } catch {
    // Already gone, or git declined. `git worktree prune` collects it later; a verdict is worth more.
  }
  try {
    rmSync(staging, { force: true, recursive: true });
  } catch {
    // A temp directory in the OS temp dir. Leaving it is not a failure worth reporting.
  }
}
