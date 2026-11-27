/**
 * The effectful git edge: runs the commands {@link ./diff} plans and returns ONE complete diff.
 *
 * Every git command runs through {@link ./gitRun}'s runner — an argv ARRAY, never a shell string, a stripped
 * `GIT_*` environment and pinned rendering config — and every one this file issues only ever reads.
 *
 * A HONEST LIMIT, stated because it cannot be fixed: capture is SEQUENTIAL. Resolving the merge base,
 * diffing tracked changes, listing untracked files and diffing each one are four separate git invocations,
 * and a file can change between them. No hash makes several commands atomic. What the hashes DO buy is
 * detectability: the artifact records the base sha, the HEAD sha and the sha256 of the exact bytes sent, so
 * a reader can prove which state was judged.
 *
 * This header used to end "and `skills/codex/SKILL.md` tells the consuming agent that any subsequent write
 * invalidates the review". That is no longer true and the correction matters more than the original claim.
 * A pass now reads a FROZEN COPY (see {@link ./snapshot}), so a write after capture cannot reach it, and the
 * artifact states which tree was read rather than leaving it to a convention nobody enforced. What a later
 * write does invalidate is the diff's RELEVANCE — the verdict is still true about the code it judged, and
 * `codex status` reports it as STALE rather than wrong. The window above stays real, and stays small.
 */

import { realpathSync } from "node:fs";

import type { IngestError } from "../lib/ingestError.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import {
  checkDiff,
  type DiffRefusal,
  gitHeadShaCommand,
  gitMergeBaseCommand,
  gitRepoRootCommand,
  gitTrackedDiffCommand,
  gitUnmergedCommand,
  gitUntrackedCommand,
  gitUntrackedDiffCommand,
} from "./diff.js";
import { type TreeFingerprint, treeFingerprint } from "./fingerprint.js";
import { decodeStrict, InvalidUtf8Error } from "./gitOutput.js";
import { git, runGitChecked } from "./gitRun.js";
import { assumeUnchangedPaths, hiddenPathsText } from "./hiddenPaths.js";
import { stableTree, treeAgreeingWithDiffHead } from "./passProvenance.js";
import type { CodexPassTree } from "./types.js";

/** {@link runGitChecked} under the short name this module's own reads use; none of them adds to the env. */
const runGit = runGitChecked;

/** A full git object id: SHA-1 (40 hex) or SHA-256 (64 hex). */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A captured review diff with everything needed to prove what was judged. */
export interface ReviewDiff {
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly repoRoot: string;
}

/** The result of trying to capture a review diff: an accepted diff, or a refusal to explain. */
export type ReviewDiffCapture = Result<ReviewDiff, DiffRefusal>;

/** Combine the tracked patch with a patch per untracked file, so nothing is silently omitted. */
function combinedDiffText({ cwd, mergeBase }: { cwd: string; mergeBase: string }): string {
  const tracked = git({ args: gitTrackedDiffCommand({ mergeBase }).args, cwd });
  const untrackedList = git({ args: gitUntrackedCommand().args, cwd });
  const untracked = untrackedList.split("\0").filter((p) => p.length > 0);
  const parts: string[] = [tracked];
  for (const path of untracked) {
    parts.push(untrackedPatch({ cwd, path }));
  }
  return parts.filter((p) => p.trim().length > 0).join("\n");
}

/**
 * The patch for ONE untracked file.
 *
 * `git diff --no-index` exits 1 whenever the files differ — which is always, here, since we compare against
 * the null device. So a non-zero exit is the SUCCESS path and the patch arrives on the error's `stdout`.
 *
 * That `stdout` is a **Buffer**, because {@link git} deliberately does not pass an encoding. An earlier
 * version of this function tested `typeof stdout === "string"` and therefore pushed an empty string for
 * every untracked file — silently omitting brand-new files from the diff under review. It was caught only
 * by counting `diff --git` headers in a real capture, never by a unit test, which is why
 * `codexGitDiff.test.ts` now asserts a real untracked file's content end-to-end.
 */
function untrackedPatch({ cwd, path }: { cwd: string; path: string }): string {
  try {
    return git({ args: gitUntrackedDiffCommand({ path }).args, cwd });
  } catch (error: unknown) {
    if (error instanceof InvalidUtf8Error) {
      throw error;
    }
    const stdout = isRecord(error) ? error["stdout"] : undefined;
    if (Buffer.isBuffer(stdout)) {
      return decodeStrict({ bytes: stdout, label: `diff --no-index ${path}` });
    }
    return typeof stdout === "string" ? stdout : "";
  }
}

/**
 * Capture the complete review diff for a base ref, or refuse with a reason.
 *
 * @param cwd the directory to run git in (a worktree is fine — the root is resolved, not assumed)
 * @param base the base ref to compare against (e.g. `origin/main`)
 * @param maxBytes the caller-supplied byte cap; there is deliberately no default
 * @returns the captured diff, the refusal, or a typed io error when git itself failed
 */
export function captureReviewDiff({
  cwd,
  base,
  maxBytes,
}: {
  cwd: string;
  base: string;
  maxBytes: number;
}): Result<ReviewDiffCapture, IngestError> {
  return safeFs({
    execute: (): ReviewDiffCapture => {
      const repoRoot = runGit({ args: gitRepoRootCommand().args, cwd, label: "git rev-parse" }).trim();
      const headSha = runGit({ args: gitHeadShaCommand().args, cwd: repoRoot, label: "git rev-parse HEAD" }).trim();
      const baseSha = runGit({
        args: gitMergeBaseCommand({ base }).args,
        cwd: repoRoot,
        label: `git merge-base ${base}`,
      }).trim();
      const unmergedPaths = runGit({ args: gitUnmergedCommand().args, cwd: repoRoot, label: "git diff --name-only" })
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      let text: string;
      try {
        text = combinedDiffText({ cwd: repoRoot, mergeBase: baseSha });
      } catch (error: unknown) {
        // Bad bytes are a REFUSAL (the diff cannot honestly be reviewed), not an io fault.
        if (error instanceof InvalidUtf8Error) {
          return err<ReviewDiff, DiffRefusal>({ kind: "invalid-utf8" });
        }
        throw error;
      }
      const check = checkDiff({ maxBytes, text, unmergedPaths });
      if (check.isErr()) {
        return err(check.error);
      }
      return ok({
        baseSha,
        bytes: check.value.bytes,
        headSha,
        repoRoot,
        sha256: check.value.sha256,
        text: check.value.text,
      });
    },
    operation: "codex.captureReviewDiff",
  });
}

/**
 * Resolve a repository root without capturing a diff — used by the plan verb, which takes no diff.
 *
 * @param cwd the directory to resolve from
 * @returns the absolute repository root
 */
export function resolveRepoRoot({ cwd }: { cwd: string }): Result<string, IngestError> {
  return safeFs({
    execute: () => runGit({ args: gitRepoRootCommand().args, cwd, label: "git rev-parse" }).trim(),
    operation: "codex.resolveRepoRoot",
  });
}

/**
 * The canonical shared `.git` of the repository a directory is a checkout of — every linked worktree reports the
 * same one, so it names the repository rather than the checkout. What a supervisor-approved pass extension
 * (`./passExtension.ts`) is scoped by, so a row for one repository's `main` never extends another's.
 *
 * @param cwd any checkout of the repository
 * @returns the absolute, symlink-resolved common git directory
 */
export function resolveGitCommonDir({ cwd }: { cwd: string }): Result<string, IngestError> {
  return safeFs({
    execute: () =>
      realpathSync(
        runGit({
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          cwd,
          label: "git rev-parse --git-common-dir",
        }).trim(),
      ),
    operation: "codex.resolveGitCommonDir",
  });
}

/**
 * Fingerprint the tree a pass is about to read, so staleness is decidable later.
 *
 * Reuses {@link combinedDiffText} against `HEAD` rather than inventing a second notion of "the tree".
 * That matters for one reason: it folds in a `--no-index` patch per untracked file. `git stash create` —
 * the shorter route — silently drops untracked files, so a branch made mostly of new source files would
 * fingerprint a tree that barely resembles the real one, and two genuinely different trees would compare
 * equal. Omitting untracked files from a diff has already been a real defect in this file; see
 * {@link untrackedPatch}.
 *
 * A path marked assume-unchanged or skip-worktree is the other thing `git diff` omits, and it is folded in
 * by {@link hiddenPathsText} rather than refused. This used to throw, and the refusal killed the landing
 * floor in every acme-admin worktree: that repository's `@acme/frontend-graphql` postinstall runs
 * `select-target.sh <target>`, which marks `packages/web-ui/tsconfig.shared.json` skip-worktree on every
 * install (62 of 89 worktrees, measured — repro: `git -C <worktree> ls-files -v | grep '^S '`).
 * Clearing the flag cannot hold against the next install, so the fingerprint looks at the file instead.
 *
 * @param cwd the directory to run git in (a worktree is fine)
 * @returns the fingerprint, or a typed io error when git itself failed
 */
export function captureTreeFingerprint({ cwd }: { cwd: string }): Result<TreeFingerprint, IngestError> {
  return safeFs({
    execute: () => {
      // ONE `rev-parse` answers the head, its tree and the root, in argument order: as three calls they were half
      // of a clean capture's six git spawns, and a spawn costs far more than the line it answers. The root comes
      // LAST because it is a raw pathname that may itself hold a newline; the two object ids never do.
      const [headSha, treeSha, ...rootLines] = runGit({
        args: ["rev-parse", "HEAD", "HEAD^{tree}", "--show-toplevel"],
        cwd,
        label: "git rev-parse HEAD HEAD^{tree} --show-toplevel",
      }).split("\n");
      // Root-relative on purpose: `ls-files` answers relative to cwd, `ls-tree --full-tree` to the root.
      const root = rootLines.join("\n").trim();
      if (
        headSha === undefined ||
        treeSha === undefined ||
        !OBJECT_ID.test(headSha) ||
        !OBJECT_ID.test(treeSha) ||
        root.length === 0
      ) {
        throw new Error("git rev-parse did not print HEAD, its tree and the root, in that order");
      }
      const hidden = hiddenPathsText({ cwd: root, paths: assumeUnchangedPaths({ cwd: root }) });
      const dirtyPatch = [combinedDiffText({ cwd, mergeBase: "HEAD" }), hidden].filter((p) => p.length > 0).join("\n");
      return treeFingerprint({ dirtyPatch, headSha, treeSha });
    },
    operation: "codex.captureTreeFingerprint",
  });
}

/**
 * The current branch, or `null` on a detached HEAD.
 *
 * `--show-current` prints an empty line rather than failing when HEAD is detached, so the empty case is
 * normal and is mapped to `null` here instead of being allowed to travel as `""`. A detached HEAD is not
 * exotic in this system: the snapshot a pass reads is one.
 *
 * @param cwd the directory to run git in
 * @param timeoutMs a tighter bound than the git runner's own read default, for a caller inside a fixed budget
 * @returns the branch name, or `null` when HEAD is detached
 */
export function currentBranch({
  cwd,
  timeoutMs,
}: {
  cwd: string;
  timeoutMs?: number;
}): Result<string | null, IngestError> {
  return safeFs({
    execute: () => {
      const name = runGit({
        args: ["branch", "--show-current"],
        cwd,
        label: "git branch --show-current",
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }).trim();
      return name.length === 0 ? null : name;
    },
    operation: "codex.currentBranch",
  });
}

/**
 * Fingerprint a COMMIT this checkout holds but has not checked out.
 *
 * The one asymmetry with {@link captureTreeFingerprint}, and the reason a landing verb can judge a pull
 * request it is not standing on: a fingerprint is `sha256(len(treeSha) + ":" + treeSha + dirtyPatch)`
 * (`./fingerprint.ts`), so for a CLEAN tree the digest is a pure function of git's tree object — and a
 * commit's tree object is readable from any checkout holding the commit, with no checkout, no fetch and no
 * mutation. The value returned here is therefore byte-identical to what `captureTreeFingerprint` returns in
 * a checkout sitting clean at `commit`.
 *
 * MEASURED, and the repro is the proof rather than the claim:
 *
 * ```bash
 * git rev-parse HEAD^{tree}   # <tree-sha>, on a clean tree
 * node -e 'const{createHash}=require("node:crypto");const t=process.argv[1];
 *   console.log(createHash("sha256").update(`${t.length}:`).update(t).update("").digest("hex"))' \
 *   <tree-sha>
 * ```
 *
 * whose output is exactly the digest `captureTreeFingerprint` reported for that worktree.
 * `unit/codex/commitFingerprint.test.ts` is the standing witness, so the two cannot drift apart silently.
 *
 * **It FAILS when the checkout does not hold the commit**, and that is the point rather than a limitation:
 * `rev-parse --verify` refuses an object it does not have, so "this checkout cannot speak for that pull
 * request" is answered by git rather than guessed. `--verify` and the `^{tree}` peel are both load-bearing —
 * a bare `rev-parse <sha>` echoes an unknown argument straight back instead of failing.
 *
 * @param cwd the checkout to read — it need not be on the commit's branch, or on any branch
 * @param commit the commit to fingerprint, as a full object name
 * @returns the fingerprint a clean checkout at `commit` would have, or a typed io error when this checkout
 *   does not hold the commit or git itself failed
 */
export function commitTreeFingerprint({
  cwd,
  commit,
}: {
  cwd: string;
  commit: string;
}): Result<TreeFingerprint, IngestError> {
  return safeFs({
    execute: () => {
      const treeSha = runGit({
        args: ["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`],
        cwd,
        label: `git rev-parse ${commit}^{tree}`,
      }).trim();
      return treeFingerprint({ dirtyPatch: "", headSha: commit, treeSha });
    },
    operation: "codex.commitTreeFingerprint",
  });
}

/**
 * Capture everything about the tree a pass is about to read, in one call.
 *
 * Returns `undefined` rather than an error when git is unavailable or the directory is not a repository.
 * That is deliberate: a missing provenance line must never stop a pass running. The consumer treats an
 * absent tree as "unknown", which is honest, where a hard failure would make the ledger a reason not to
 * use the loop at all.
 *
 * @param cwd the directory the pass will read
 * @returns the tree provenance, or `undefined` when it could not be determined
 */
export function capturePassTree({ cwd }: { cwd: string }): CodexPassTree | undefined {
  const fingerprint = captureTreeFingerprint({ cwd });
  if (fingerprint.isErr()) {
    return undefined;
  }
  const branch = currentBranch({ cwd });
  const captured = fingerprint._unsafeUnwrap();
  return {
    branch: branch.isOk() ? branch._unsafeUnwrap() : null,
    dirtyBytes: captured.dirtyBytes,
    fingerprint: captured.digest,
    headSha: captured.headSha,
    treeSha: captured.treeSha,
  };
}

/**
 * Capture the review diff and the provenance of the tree it came from — the two halves that must not be
 * separated.
 *
 * Provenance BRACKETS the capture, for the reason this file's own header already concedes and could not fix:
 * reading a diff is four sequential git invocations and no hash makes them atomic. What the hashes buy is
 * DETECTABILITY, and this is where that is spent. A disagreement between the endpoints says the diff may
 * describe no single state, and then the honest record is no provenance at all rather than either endpoint —
 * and because two agreeing endpoints prove nothing about the middle, the diff's OWN observation of HEAD is
 * checked against them too ({@link treeAgreeingWithDiffHead}).
 *
 * ONE reading serves the WHOLE fan-out, and that is the point rather than an efficiency. Every property is
 * handed the byte-identical diff, so every property's record must name the same tree — the one the diff came
 * from. Capturing per property instead let a property that waited behind the concurrency cap record the tree
 * as it stood when its slot opened, which is a tree it never read and, since `codex status`'s review floor
 * wants a CURRENT review, exactly the provenance that makes a stale review look like a fresh one. See
 * `./passProvenance.ts`'s `reviewPassProvenance`.
 *
 * @param base the base ref to diff against
 * @param cwd the directory to resolve the repository from
 * @param maxBytes the diff ceiling, above which capture refuses rather than truncates
 * @returns the captured diff (or its refusal) alongside the tree it came from, `undefined` when the tree
 *   could not be read consistently
 */
export function captureReviewDiffWithProvenance({
  base,
  cwd,
  maxBytes,
}: {
  base: string;
  cwd: string;
  maxBytes: number;
}): Result<{ readonly capture: ReviewDiffCapture; readonly tree: CodexPassTree | undefined }, IngestError> {
  const root = resolveRepoRoot({ cwd });
  if (root.isErr()) {
    return err(root.error);
  }
  const repoRoot = root.value;
  const before = capturePassTree({ cwd: repoRoot });
  const capture = captureReviewDiff({ base, cwd: repoRoot, maxBytes });
  if (capture.isErr()) {
    return err(capture.error);
  }
  const after = capturePassTree({ cwd: repoRoot });
  // No snapshot is taken to read a diff, so there is no third reading to compare: both content addresses are
  // absent, which {@link stableTree} reads as "no third opinion" rather than as a disagreement.
  const bracketed = stableTree({ after, before, liveContentTree: undefined, snapshotContentTree: undefined });
  return ok({
    capture: capture.value,
    tree: capture.value.isOk()
      ? treeAgreeingWithDiffHead({ diffHeadSha: capture.value.value.headSha, tree: bracketed })
      : bracketed,
  });
}
