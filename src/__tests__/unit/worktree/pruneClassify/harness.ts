/*
 * What more than one worktree-prune classification test file reads: the fixed clock, a day, the pair of thresholds
 * every case is judged under, the strictly-safe worktree's facts and the classifier called over them. A plain
 * module, not a `*.test.ts`, so no test registers twice. It was split out when the prune classification suite
 * became one file per behaviour.
 */
import { classifyWorktree, type PruneVerdict, type WorktreeFacts } from "../../../../worktree/pruneClassify.js";

/** The instant every case is judged at, so an age is exact. */
export const NOW_MS: number = 1_800_000_000_000;
/** One day in milliseconds. */
export const DAY_MS: number = 86_400_000;
/** `--older-than`, the coldness threshold every case is judged under. */
export const OLDER_THAN_MS: number = DAY_MS;
/** `--nuke-after`'s own default, so every existing case is judged under the real pair of thresholds. */
export const NUKE_AFTER_MS: number = 7 * DAY_MS;

/**
 * A worktree that is merged, clean, unreferenced and cold — the strictly-safe class, overridden per test.
 *
 * @returns the strictly-safe worktree's facts with each overridden field replaced
 */
export const facts = (over: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  branch: "landed-work",
  deletionsOnly: false,
  freshSnapshot: false,
  diskKib: 500_000,
  dirtyCount: 0,
  hiddenFromStatus: 0,
  headOnRemoteRef: null,
  headSha: null,
  ignoredWork: [],
  isMainCheckout: false,
  lastActivityMs: NOW_MS - 5 * DAY_MS,
  liveRefs: [],
  locked: false,
  mergedIntoTrunk: true,
  missing: false,
  openPullRequests: [],
  path: "/repo/.claude/worktrees/landed-work",
  runClosed: false,
  branchOnOwnRemote: false,
  stashes: 0,
  unbackedCommits: 0,
  ...over,
});

/**
 * Classify the strictly-safe worktree with the given overrides, at {@link NOW_MS} under the default thresholds.
 *
 * @returns the verdict `classifyWorktree` reaches for those facts
 */
export const classify = (over: Partial<WorktreeFacts> = {}): PruneVerdict =>
  classifyWorktree({ facts: facts(over), nowMs: NOW_MS, nukeAfterMs: NUKE_AFTER_MS, olderThanMs: OLDER_THAN_MS });
