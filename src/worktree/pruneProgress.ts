/**
 * The one line every `worktree prune --apply` prints that says whether the stale count is falling, and whether a
 * zero means anything.
 *
 * ## Why it exists
 *
 * An hourly prune that still leaves over two hundred trees standing is itself the sign something is wrong. The
 * hourly row's slot ledger read "worked" on 141 of 144
 * firings while the backlog sat over 200, because exit 0 means a run ended cleanly, not that it caught up. So
 * each apply prints its own count, under the trigger's timestamp and cause in
 * `$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log`, and successive hourly sections are the proof:
 *
 *   grep -E '^20[0-9-]+T.*cause=|^prune-progress ' "$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log" | tail -20
 *
 * **A zero is a witness only when the scan was complete.** The scan is bounded and round-robin, so a run that did
 * not reach every tree can owe nothing among the trees it saw while owing plenty it did not (`./pruneSweep.ts`).
 */

/** What one apply pass reports about the backlog. */
export interface PruneProgress {
  /** Every candidate the scan offered this pass. */
  readonly candidates: number;
  /** Trees the pass actually removed. */
  readonly removed: number;
  /** Candidates still owed afterwards — every one not removed, reached-and-kept included. */
  readonly owedAfter: number;
  /** Whether every declared repository was read and its scan reached every registered tree. */
  readonly scanComplete: boolean;
}

/** The prefix a reader greps for; stable, so the line is an interface rather than prose. */
export const PRUNE_PROGRESS_PREFIX = "prune-progress";

/**
 * Render the progress line: the stable prefix, then one compact JSON object with its fields in a fixed order.
 *
 * @param progress the pass's counts and whether its scan was whole
 * @returns the line, such as `prune-progress {"candidates":242,"owedAfter":210,"removed":32,"scanComplete":true}`
 */
export function pruneProgressLine({ progress }: { progress: PruneProgress }): string {
  const ordered = {
    candidates: progress.candidates,
    owedAfter: progress.owedAfter,
    removed: progress.removed,
    scanComplete: progress.scanComplete,
  };
  return `${PRUNE_PROGRESS_PREFIX} ${JSON.stringify(ordered)}`;
}

/**
 * Whether a scan saw the whole of what it was asked to: every declared repository read, and none of them left
 * with a tree the scan budget never reached.
 *
 * @param asked how many main checkouts the run was asked to sweep
 * @param read how many of them produced a worktree list
 * @param unreached each read repository's count of registered trees the scan did not classify
 * @returns true only when nothing went unseen
 */
export function scanWasComplete({
  asked,
  read,
  unreached,
}: {
  asked: number;
  read: number;
  unreached: readonly number[];
}): boolean {
  return asked === read && unreached.every((count) => count === 0);
}
