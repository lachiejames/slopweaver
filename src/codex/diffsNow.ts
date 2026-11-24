/**
 * The current review diff per base ref — the effectful half of `./ledger.ts`'s rule that a review whose DIFF
 * did not move is still current after a conflict-free rebase (see `freshnessOf` there, and `./duplicate.ts`,
 * whose key the rule agrees with).
 *
 * Two shapes, because the ledger is asked about two different things. `codex status` and `codex supersede`
 * judge the WORKTREE, dirty edits and untracked files included, so they hash exactly what `codex review`
 * would capture there. The landing floor judges a pull request's head COMMIT from whichever checkout holds
 * it, so it hashes what a clean checkout at that commit would capture, without checking it out.
 *
 * Every failure is an OMITTED entry and never a guessed one: a ref missing from the map leaves a stale review
 * stale, which is the direction this rule may fail in.
 */
import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { diffSha256, gitCommitDiffCommand, gitCommitMergeBaseCommand } from "./diff.js";
import { type LandingBaseDiff, reviewBaseRefs } from "./diffCarry.js";
import { captureReviewDiff } from "./gitDiff.js";
import { runGitChecked } from "./gitRun.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * No spend rides on this read, so it carries no review-sized cap: a recorded review's diff passed its own
 * cap, and a current diff larger than that cannot match it. Git's own read is still bounded (`gitRun.ts`).
 */
const UNCAPPED = Number.MAX_SAFE_INTEGER;

/**
 * The sha256 of the diff `codex review` would capture in this worktree now, per base ref.
 *
 * @param cwd the checkout being judged
 * @param baseRefs the refs to take it against (`reviewBaseRefs` in `./diffCarry.ts`)
 * @returns base ref → digest, holding only the refs whose capture succeeded
 */
function worktreeDiffsNow({
  baseRefs,
  cwd,
}: {
  baseRefs: readonly string[];
  cwd: string;
}): ReadonlyMap<string, string> {
  const diffs = new Map<string, string>();
  for (const base of baseRefs) {
    const captured = captureReviewDiff({ base, cwd, maxBytes: UNCAPPED });
    if (captured.isOk() && captured.value.isOk()) {
      diffs.set(base, captured.value.value.sha256);
    }
  }
  return diffs;
}

/**
 * {@link worktreeDiffsNow} for every base ref this checkout's review passes on `branch` were taken against —
 * the `diffsNow` `codex status` and `codex supersede` hand the ledger.
 *
 * @param records every pass record that could be read
 * @param repoRoot the checkout being judged
 * @param branch the branch the ledger is about
 * @returns base ref → digest, holding only the refs whose capture succeeded
 */
export function worktreeDiffsForBranch({
  branch,
  records,
  repoRoot,
}: {
  branch: string;
  records: readonly CodexArtifactRecord[];
  repoRoot: string;
}): ReadonlyMap<string, string> {
  return worktreeDiffsNow({ baseRefs: reviewBaseRefs({ branch, records, repoRoot }), cwd: repoRoot });
}

/**
 * The sha256 of the review diff a CLEAN checkout at `commit` would capture against `base`, without a checkout.
 *
 * The commit-side twin of `captureReviewDiff`'s hash. A clean checkout's combined diff is its tracked part
 * alone, and `gitCommitDiffCommand` (`./diff.ts`) produces that part's exact bytes from the commit — see its
 * measurement. Run through `runGitChecked`, so the canonical config that pins the diff's bytes applies here too.
 *
 * No refusal rules are applied, and none are needed: this hash is only ever COMPARED to a recorded review's
 * `diffSha256`, and a diff those rules would refuse never produced a recorded review to match.
 *
 * @param cwd a checkout holding `commit` — it need not have it checked out
 * @param base the base ref the recorded review was taken against
 * @param commit the commit being judged, as a full object name
 * @returns the hex digest, or a typed io error when git failed (an unknown base ref, a missing commit)
 */
export function commitDiffSha256({
  base,
  commit,
  cwd,
}: {
  base: string;
  commit: string;
  cwd: string;
}): Result<string, IngestError> {
  return safeFs({
    execute: () => {
      const mergeBase = runGitChecked({
        args: gitCommitMergeBaseCommand({ base, commit }).args,
        cwd,
        label: `git merge-base ${base} ${commit}`,
      }).trim();
      const text = runGitChecked({ args: gitCommitDiffCommand({ commit, mergeBase }).args, cwd, label: "git diff" });
      return diffSha256({ diff: text });
    },
    operation: "codex.commitDiffSha256",
  });
}

/**
 * Everything a landing reader hands the ledger for the carried-diff rule, for ONE checkout: the diff per base
 * ref its review passes on the branch name, and the diff the pull request presents against its current base
 * (`LandingBaseDiff` in `./diffCarry.ts`, which carries why both exist).
 *
 * Read by the landing floor (`./landingGateRun.ts`), which applies the landing-base diff to every review row. The
 * ratchet-bump witness does not take this function: `./baselineBumpFloor.ts` hashes the same landing diff, and the
 * witness predicate (`./baselineBumpWitness.ts`) carries a stale witness only when the manifest's named baseline
 * files are also unchanged between its base and the landing base. A checkout holding no review record on
 * the branch costs no git call: it merely holds the head, and nothing there could be carried. Every git failure is an
 * omitted digest, never a guessed one, so it leaves a stale review stale.
 *
 * @param baseSha the pull request's base commit (GitHub's `baseRefOid`); `undefined` takes no landing-base diff
 * @param branch the pull request's head branch
 * @param commit the pull request head being judged, as a full object name
 * @param records every pass record that could be read
 * @param repoRoot the checkout to read from, which must hold `commit`
 * @returns the per-base-ref digests, and the landing-base diff when one was taken
 */
export function pullRequestCarryEvidence({
  baseSha,
  branch,
  commit,
  records,
  repoRoot,
}: {
  baseSha: string | undefined;
  branch: string;
  commit: string;
  records: readonly CodexArtifactRecord[];
  repoRoot: string;
}): { readonly diffsNow: ReadonlyMap<string, string>; readonly landingBaseDiff: LandingBaseDiff | undefined } {
  const baseRefs = reviewBaseRefs({ branch, records, repoRoot });
  const diffsNow = commitDiffsNow({ baseRefs, commit, cwd: repoRoot });
  if (baseRefs.length === 0 || baseSha === undefined) {
    return { diffsNow, landingBaseDiff: undefined };
  }
  const digest = commitDiffSha256({ base: baseSha, commit, cwd: repoRoot });
  return { diffsNow, landingBaseDiff: digest.isOk() ? { baseSha, sha256: digest.value } : undefined };
}

/**
 * The sha256 of the diff a clean checkout at `commit` would capture, per base ref, read from `cwd`.
 *
 * @param cwd a checkout holding `commit`
 * @param commit the pull request head being judged
 * @param baseRefs the refs to take it against (`reviewBaseRefs` in `./diffCarry.ts`)
 * @returns base ref → digest, holding only the refs git could answer for
 */
export function commitDiffsNow({
  baseRefs,
  commit,
  cwd,
}: {
  baseRefs: readonly string[];
  commit: string;
  cwd: string;
}): ReadonlyMap<string, string> {
  const diffs = new Map<string, string>();
  for (const base of baseRefs) {
    const digest = commitDiffSha256({ base, commit, cwd });
    if (digest.isOk()) {
      diffs.set(base, digest.value);
    }
  }
  return diffs;
}
