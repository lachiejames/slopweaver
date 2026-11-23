/**
 * The `snapshot` class's decision, split from `./pruneClassify.ts`: a one-off Codex snapshot is judged by rules of
 * its own, before any rule about work, so it sits beside the classifier rather than inside its hold chain.
 */
import { FRESH_SNAPSHOT_MIN_AGE_MS } from "./freshSnapshotPath.js";
import type { PruneVerdict, WorktreeFacts } from "./pruneClassify.js";
import { renderAge } from "./pruneColdness.js";

/**
 * The verdict for a one-off Codex snapshot, or `undefined` for every other tree.
 *
 * A snapshot is a frozen copy of another tree, so none of the rules about WORK apply to it: its HEAD is a synthetic
 * commit no remote will ever carry, its deletions are an interrupted release, and salvaging it would push that
 * synthetic commit to a remote branch. What keeps it is only what says it is in use — a live reference, a git lock, and an age
 * under {@link FRESH_SNAPSHOT_MIN_AGE_MS}, past which no Codex pass that could be reading it is still running. An
 * unreadable timestamp or HEAD holds, like every `null` in the classifier; the HEAD the scan read rides on the
 * verdict, because the removal goes at that HEAD only (`./pruneRecheck.ts#pinSnapshot`). The main checkout is never
 * one by construction.
 *
 * @param facts the gathered facts
 * @param nowMs the instant the whole plan is judged against
 * @returns the snapshot verdict or its hold, or `undefined` when the tree is not a one-off snapshot
 */
export function snapshotDecision({
  facts,
  nowMs,
}: {
  facts: WorktreeFacts;
  nowMs: number;
}): Pick<PruneVerdict, "cls" | "deleteBranch" | "reason" | "scannedHead"> | undefined {
  if (!facts.freshSnapshot || facts.isMainCheckout || facts.missing) {
    return undefined;
  }
  if (facts.liveRefs.length > 0) {
    return { cls: "hold", deleteBranch: false, reason: `referenced by ${facts.liveRefs.join(", ")}` };
  }
  if (facts.locked) {
    return { cls: "hold", deleteBranch: false, reason: "locked by `git worktree lock`" };
  }
  if (facts.lastActivityMs === null) {
    return { cls: "hold", deleteBranch: false, reason: "no activity timestamp could be read" };
  }
  if (facts.headSha === null) {
    return { cls: "hold", deleteBranch: false, reason: "its HEAD could not be read" };
  }
  const ageMs = nowMs - facts.lastActivityMs;
  if (ageMs < FRESH_SNAPSHOT_MIN_AGE_MS) {
    return {
      cls: "hold",
      deleteBranch: false,
      reason: `a Codex snapshot touched ${renderAge({ ms: ageMs })} ago — a pass may still be reading it`,
    };
  }
  return {
    cls: "snapshot",
    deleteBranch: false,
    reason: `a one-off Codex snapshot left behind ${renderAge({ ms: ageMs })} ago — a frozen copy, nothing is lost`,
    scannedHead: facts.headSha,
  };
}
