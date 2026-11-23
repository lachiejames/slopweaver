/**
 * The coldness rule — rule 16 of `./pruneClassify`'s `HOLD_RULES` — and the open-pull-request hold it asks
 * first. Kept apart from the ordered list because the apply's live re-read (`cli/commands/worktree/pruneLiveState.ts`)
 * judges a pull request taken since the scan with the same {@link openPullRequestHold}, against the same
 * `--older-than`, and a second copy of that test would drift from the first.
 */

import type { WorktreeFacts } from "./pruneClassify.js";
import { resumableFromItsBranch } from "./pruneWitness.js";

/** An hour, in milliseconds — the unit `--older-than` is expressed in. */
const HOUR_MS = 3_600_000;

/**
 * How long ago an activity timestamp was, rendered for a hold reason.
 *
 * @param ms the elapsed milliseconds
 * @returns a compact age such as `3h` or `2d`
 */
export function renderAge({ ms }: { ms: number }): string {
  // Clamped, because an activity stamp AHEAD of the clock is real rather than hypothetical: one worktree in
  // a dry run carried a commit date in the future and rendered "touched -1h ago". The hold itself is
  // right either way — anything under the threshold is held — so only the sentence needed fixing.
  const hours = Math.floor(Math.max(0, ms) / HOUR_MS);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * How long a RECREATABLE tree stays warm — one whose branch the trunk already carries, or whose own remote branch
 * carries everything in it: two hours, not `--older-than`'s day.
 *
 * MEASURED for the merged half: the dry run held two merged, clean, unreferenced trees as `touched 11h ago` and
 * `touched 6h ago`, and each branch was 0 commits ahead of the trunk with a one-entry reflog
 * (`branch: Created from refs/slopweaver/fetch/<uuid>`) — a fresh cut whose session ended, never worked in.
 * Reproduce on a held merged tree with `git -C <repo> rev-list --count origin/main..<branch>` and
 * `git -C <repo> reflog show <branch>`. A session about to start in such a cut is not lost to this: `cmux spawn`
 * waits for capacity BEFORE it creates the tree, a seated session holds it by workspace and cwd, and a
 * removed cut is recreated on the next spawn from a branch every commit of which the trunk carries.
 *
 * MEASURED for the pushed half, and why it is a floor rather than nothing: a clean tree on its own pushed branch
 * with no open pull request once disarmed the coldness rule outright, and `auto-prune.log` on this machine records
 * the unattended apply removing one such tree four times inside 37 minutes, the first 12 minutes after its newest
 * commit, while a seat whose cwd was ANOTHER worktree worked in it between pushes — so no live register could see
 * it. Reproduce with `grep -n "tree removed, branch kept" <home>/worktree-bundles/auto-prune.log`. Two hours is the
 * merged floor reused, not a separately measured idle time: it frees such a tree about 22 hours before the base
 * 24-hour rule does, and it holds every one of those four removals.
 */
const RECREATABLE_ACTIVITY_FLOOR_MS: number = 2 * HOUR_MS;

/**
 * Whether an open pull request on this tree's branch holds it: only while the tree is WARM.
 *
 * A pull request is open on a pushed branch, so a cold tree under one is recreatable from that branch and goes;
 * a warm one is where somebody is still answering its review or its CI, and stays. An unreadable activity stamp
 * holds, because nothing shows that tree cold. The scan and the apply's live re-read both judge a pull request
 * here, against the same `--older-than`.
 *
 * @param openPullRequests the labels of every open pull request whose head is the tree's branch
 * @param lastActivityMs the tree's newest activity stamp, or `null` when none could be read
 * @param nowMs the instant the tree is judged against
 * @param olderThanMs how long untouched a tree must be before a pull request stops holding it
 * @returns the hold reason, or `undefined` when no pull request is open or the tree is cold
 */
export function openPullRequestHold({
  openPullRequests,
  lastActivityMs,
  nowMs,
  olderThanMs,
}: {
  openPullRequests: readonly string[];
  lastActivityMs: number | null;
  nowMs: number;
  olderThanMs: number;
}): string | undefined {
  if (openPullRequests.length === 0) {
    return undefined;
  }
  const labels = openPullRequests.join(", ");
  if (lastActivityMs === null) {
    return `no activity timestamp could be read, with ${labels} on its branch`;
  }
  const ageMs = nowMs - lastActivityMs;
  if (ageMs < olderThanMs) {
    return `touched ${renderAge({ ms: ageMs })} ago, with ${labels} on its branch`;
  }
  return undefined;
}

/**
 * How long untouched this tree must be before the coldness rule lets it go, or `null` when the rule is disarmed.
 *
 * A CLOSED board row disarms it outright (owner: a finished run is cold whatever touched its directory since). A
 * recreatable tree — its branch in the trunk, or everything in it on its own remote branch — is judged against
 * {@link RECREATABLE_ACTIVITY_FLOOR_MS}, and the narrower of that and `--older-than` always wins, so a caller's tighter
 * window stays tighter. Every other tree keeps the whole `--older-than`. The classifier stamps this on a removal
 * verdict so the apply judges the tree's activity again against the SAME window, right before it removes it.
 *
 * @param facts the gathered facts
 * @param olderThanMs how long untouched a tree must be
 * @returns the window in milliseconds, or `null` when a CLOSED row disarms the rule
 */
export function coldnessWindowMs({ facts, olderThanMs }: { facts: WorktreeFacts; olderThanMs: number }): number | null {
  if (facts.runClosed) {
    return null;
  }
  if (facts.mergedIntoTrunk === true || resumableFromItsBranch({ facts })) {
    return Math.min(olderThanMs, RECREATABLE_ACTIVITY_FLOOR_MS);
  }
  return olderThanMs;
}

/**
 * The coldness rule: whether this tree is still warm enough to keep.
 *
 * An open pull request is asked FIRST and holds a warm tree for the whole `--older-than`, over-riding both the
 * CLOSED-row disarm and the recreatable floor, because a tree with one has its branch pushed and is where somebody
 * is still answering its review or CI. With none, {@link coldnessWindowMs} decides: no age test for a CLOSED row,
 * the two-hour floor for a recreatable tree, and `--older-than` for the rest. An unreadable stamp is the previous
 * rule's to hold, never this one's.
 *
 * @param facts the gathered facts
 * @param nowMs the instant the whole plan is judged against
 * @param olderThanMs how long untouched a tree must be
 * @returns `touched <age> ago` with any pull request named, or `undefined` when the tree is cold
 */
export function coldnessHold({
  facts,
  nowMs,
  olderThanMs,
}: {
  facts: WorktreeFacts;
  nowMs: number;
  olderThanMs: number;
}): string | undefined {
  const pullRequest = openPullRequestHold({
    lastActivityMs: facts.lastActivityMs,
    nowMs,
    olderThanMs,
    openPullRequests: facts.openPullRequests,
  });
  if (pullRequest !== undefined) {
    return pullRequest;
  }
  // A pull request open on a COLD tree has already been judged above; it no longer re-arms anything here.
  const windowMs = coldnessWindowMs({ facts, olderThanMs });
  if (windowMs === null || facts.lastActivityMs === null) {
    return undefined;
  }
  const ageMs = nowMs - facts.lastActivityMs;
  if (ageMs < windowMs) {
    return `touched ${renderAge({ ms: ageMs })} ago`;
  }
  return undefined;
}
