/**
 * `worktree prune`'s SCAN PHASE: queue every asked-for repository, scan it within its budget, and move the scan
 * cursors on — the half of one run (`./pruneRun.ts`) that ends where the plan is printed. Split out along that seam
 * because the scan's last act, the lock read before the cursors move, decides whether the run goes on at all.
 */
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { mergeScanCursors } from "../../../worktree/pruneSweep.js";
import type { LiveState } from "./pruneLiveState.js";
import { queueRepo, type RepoQueue, readScanCursors, scanRepos, writeScanCursors } from "./pruneScanPass.js";

/** What the scan read, and the repositories it was able to queue. */
export interface ScanPhase {
  readonly pass: ReturnType<typeof scanRepos>;
  readonly queues: readonly RepoQueue[];
}

/** Why an apply ends straight after its scan once another run has taken its lock over. */
const LOCK_LOST_AFTER_SCAN =
  "worktree prune: another run took this run's apply lock over mid-scan, so that run removes";

/**
 * Scan every asked-for repository, and on an apply move the cursors on — unless the lock went while it scanned.
 *
 * A run whose lock another run took over mid-scan ends here: its cursors would rewind that run's, and
 * its removals would race that run's. Only an apply moves a cursor: a dry run reads where the next
 * apply resumes and leaves it there.
 *
 * @param repos the main checkouts to scan, in sweep order
 * @param apply whether this run removes, and so moves the cursors and holds a lock it can lose
 * @param live the live registers read once for the scan
 * @param nukeAfterMs the age past which a tree goes whatever it holds, as the options resolved it
 * @param olderThanMs the age a tree must reach before it is a candidate at all
 * @param scanBudgetMs how long the scan may read before it stops and says what it did not reach
 * @param lockHeld whether this run still holds the apply lock — always true for a dry run
 * @param home the state home the cursors and run records live under
 * @returns what the scan read, or null when the run lost its lock and must stop
 */
export function scanPhase({
  repos,
  apply,
  live,
  nukeAfterMs,
  olderThanMs,
  scanBudgetMs,
  lockHeld,
  home,
}: {
  repos: readonly string[];
  apply: boolean;
  live: LiveState;
  nukeAfterMs: number;
  olderThanMs: number;
  scanBudgetMs: number;
  lockHeld: () => boolean;
  home: string;
}): ScanPhase | null {
  const nowMs = Date.now();
  const queues = repos.map((repoRoot) => queueRepo({ repoRoot })).filter((queue): queue is RepoQueue => queue !== null);
  const pass = scanRepos({
    cursors: readScanCursors({ home }),
    live,
    nowMs,
    nukeAfterMs,
    olderThanMs,
    queues,
    runsDir: stateHomePaths({ home }).runs,
    scanBudgetMs,
  });
  if (apply && !lockHeld()) {
    logger.out({ line: LOCK_LOST_AFTER_SCAN });
    return null;
  }
  if (apply) {
    const queued = new Set(queues.map((queue) => queue.repoRoot));
    const cursors = mergeScanCursors({ previous: readScanCursors({ home }), queued, written: pass.cursors });
    writeScanCursors({ cursors, home });
  }
  return { pass, queues };
}
