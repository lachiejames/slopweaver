/**
 * The pure decisions behind `slopweaver checkout sync` — fast-forward a main checkout, then install if the
 * pull made the installed tree wrong.
 *
 * ## Why the install is part of the same verb rather than a thing to remember
 *
 * The ruling: after a git pull on a main worktree, run a `yarn install` so `node_modules` reflects the
 * pulled tree. A remembered second step is a step that gets skipped,
 * and when it is skipped the symptom appears somewhere else entirely — a provider call throwing before the
 * network, with CI green the whole time. So the pull and the install are one operation here, and the verb
 * prints the sentence that says which of the two it did and why.
 *
 * ## Why it never rebases
 *
 * A long-lived branch that has drifted from the trunk it forked off needs a human: a rebase can conflict, can
 * silently take the wrong side, and is not undoable by a tool that has already moved on. Auto-rebasing is
 * explicitly out of scope (`docs/main-checkouts/cwd-safety-and-scope.md`); `sync` fast-forwards a branch onto its OWN upstream,
 * which either applies cleanly or refuses, and reports rebase-target drift without touching it.
 *
 * Pure: no git, no filesystem, no subprocess.
 */
import { type AheadBehind, type CheckoutFreshness, dependencyPathsAmong, type InstallFreshness } from "./freshness.js";

/**
 * What a FAILED `git merge --ff-only` turns out to mean, once the branch is re-measured against its upstream.
 *
 * - `upstream-contained` — HEAD already holds every upstream commit: nothing was left to do, or another
 *   process finished the same fast-forward first.
 * - `diverged` — both sides carry commits the other lacks. The one case that genuinely needs a human.
 * - `retryable` — still a clean fast-forward, so git failed for some OTHER reason. Measured: a
 *   concurrent `git status` in the same checkout holding `.git/index.lock` fails a fast-forwardable merge
 *   with exit 1 and moves nothing (5 of 200 merges, against a `git status --porcelain` loop).
 * - `unmeasurable` — the re-measurement itself could not be read.
 */
export type FailedFastForwardState = "diverged" | "retryable" | "unmeasurable" | "upstream-contained";

/**
 * Classify a failed fast-forward from a FRESH ahead/behind reading taken after the failure.
 *
 * A failed `--ff-only` alone proves nothing about divergence: git reports a held lock and a real divergence
 * through the same non-zero exit, and the read seam keeps neither its stderr nor its status. The refs do
 * prove it, so the refs decide. `behind === 0` comes first because an ahead-only HEAD has nothing to pull.
 *
 * @param drift the reading of `<upstream>...HEAD` taken after the failed merge, undefined when unreadable
 * @returns what the failure means
 */
export function classifyFailedFastForward({ drift }: { drift: AheadBehind | undefined }): FailedFastForwardState {
  if (drift === undefined) {
    return "unmeasurable";
  }
  if (drift.behind === 0) {
    return "upstream-contained";
  }
  if (drift.ahead > 0) {
    return "diverged";
  }
  return "retryable";
}

/**
 * Why a sync must not touch this checkout.
 *
 * @param freshness the checkout as already measured
 * @returns the refusal reason, or `undefined` when the sync may proceed
 */
export function syncPreflightRefusal({ freshness }: { freshness: CheckoutFreshness }): string | undefined {
  if (freshness.problems.length > 0) {
    return `${freshness.path}: ${freshness.problems.join("; ")}`;
  }
  if (freshness.branch === undefined) {
    return `${freshness.path}: detached HEAD — nothing to fast-forward`;
  }
  if (freshness.upstream === undefined) {
    return `${freshness.path}: ${freshness.branch} tracks no upstream, so there is nothing to be current WITH`;
  }
  if (freshness.dirtyEntries !== undefined && freshness.dirtyEntries > 0) {
    return `${freshness.path}: ${String(freshness.dirtyEntries)} uncommitted change(s) — a main checkout must be clean before it is fast-forwarded`;
  }
  return undefined;
}

/** Whether an install must follow a pull, and the sentence saying why. */
export interface InstallDecision {
  readonly install: boolean;
  readonly why: string;
}

/**
 * Decide whether `yarn install` must follow a fast-forward.
 *
 * Two independent triggers, and the second is the one that caught the measured failure. A pull that changed
 * a dependency file obviously invalidates the tree. But a checkout can ALSO arrive here already stale — a
 * previous pull that nobody installed after — and a sync that only looked at its own diff would fast-forward
 * a broken tree and report success.
 *
 * @param changedPaths the repo-relative paths the fast-forward brought in
 * @param installBefore how the installed tree stood BEFORE the fast-forward
 * @returns whether to install, and why
 */
export function installDecision({
  changedPaths,
  installBefore,
}: {
  changedPaths: readonly string[];
  installBefore: InstallFreshness;
}): InstallDecision {
  const dependencyPaths = dependencyPathsAmong({ changedPaths });
  if (dependencyPaths.length > 0) {
    return { install: true, why: `the pull changed ${dependencyPaths.join(", ")}` };
  }
  if (installBefore !== "current") {
    return { install: true, why: `node_modules was already ${installBefore} before this pull` };
  }
  return { install: false, why: "the pull touched no dependency file and node_modules already matched the lockfile" };
}
