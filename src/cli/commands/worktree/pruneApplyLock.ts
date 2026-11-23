/**
 * Who gets the `worktree-prune-apply` lock when two applies meet: an automatic one steps aside, a manual one waits.
 *
 * ## The failure this answers
 *
 * A second `--apply` waits for the lock rather than being refused, whoever launched it. MEASURED: the drain asked
 * for the stale pool (`--budget 480m`) was refused by a threshold launch that had
 * taken the lock with the default 15-minute budget, so the long drain removed nothing and had
 * to be started again by hand. The hourly row and the threshold trigger refuse each other in the same way.
 * The refusal line names the holder's pid and the time it took the lock, so a repeat can be checked against
 * `ps -o pid,etime,command -p <pid>`.
 *
 * ## The rule
 *
 * - **`--if-idle`** (the hourly row and the threshold trigger pass it) answers contention at once: the run
 *   holding the lock is already doing this one's work, so stepping aside is the right answer and it exits
 *   `EXIT_EXPECTED_EMPTY`, as before.
 * - **Without it** (a person or a seat asking for a drain) the run WAITS for the holder, polling every
 *   {@link PRUNE_LOCK_POLL_MS}, for up to its own scan budget plus removal budget — the longest a default
 *   holder can run — then makes a final attempt. It says once on stderr that it is waiting and on whom.
 * - **`LOCK_REFUSED`** is never waited out: a lock no rerun clears is a fault, `EXIT_ERROR`, at once.
 *
 * The holder is never interrupted. A `git worktree remove` cut in half leaves a tree git refuses forever, so
 * a waiter cannot preempt a holder; it can only take the lock the moment that holder lets it go, or dies. Its
 * retries never apply the lease, so waiting cannot age a live holder into a takeover.
 */
import type { DetailedOperationLockResult, OperationLockHandle } from "../../../admit/operationLock.js";

/** How often a waiting apply tries the lock again. A holder's release is a directory rename, so this is the latency. */
export const PRUNE_LOCK_POLL_MS = 15_000;

/** What trying for the apply lock came to. */
export type PruneApplyLockOutcome =
  | { readonly kind: "held"; readonly handle: OperationLockHandle }
  | { readonly kind: "contended"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

/** The effects one attempt needs, as plain seams so a test drives it with fakes. */
export interface PruneApplyLockDeps {
  /**
   * One attempt at the lock. A `retry` must never take over a LIVE holder on age: only the first attempt may apply
   * the lease, exactly as an apply always has, so a waiter can only ever take a lock its holder let go or died
   * holding — never preempt one wedged past the lease while it waited.
   */
  readonly acquire: (input: { retry: boolean }) => DetailedOperationLockResult;
  /** Say, once, that this run is waiting and on whom. */
  readonly announce: (input: { line: string }) => void;
  /** The clock the wait is bounded by. */
  readonly nowMs: () => number;
  /** Wait this long before the next attempt. */
  readonly wait: (input: { ms: number }) => Promise<void>;
}

/**
 * One attempt, folded into the outcome a caller branches on.
 *
 * @returns held, contended with the holder's description, or refused
 */
function attempt({ deps, retry }: { deps: PruneApplyLockDeps; retry: boolean }): PruneApplyLockOutcome {
  const result = deps.acquire({ retry });
  if (result.isOk()) {
    return { handle: result.value, kind: "held" };
  }
  if (result.error.code === "LOCK_CONTENDED") {
    return { kind: "contended", message: result.error.message };
  }
  return { kind: "refused", message: result.error.message };
}

/**
 * Take the apply lock: at once under `--if-idle`, else waiting for a live holder up to `waitBudgetMs`.
 *
 * @param ifIdle whether this run steps aside for a holder (the automatic triggers) rather than waiting
 * @param waitBudgetMs how long a waiting run waits before its final attempt
 * @param deps the attempt, the announcement, the clock and the wait
 * @returns the held lock, or why this run does not hold it — contended (step aside) or refused (a fault)
 */
export async function acquirePruneApplyLock({
  ifIdle,
  waitBudgetMs,
  deps,
}: {
  ifIdle: boolean;
  waitBudgetMs: number;
  deps: PruneApplyLockDeps;
}): Promise<PruneApplyLockOutcome> {
  const first = attempt({ deps, retry: false });
  if (first.kind !== "contended" || ifIdle) {
    return first;
  }
  deps.announce({
    line: `worktree prune: another --apply holds the lock, so this one waits for it (up to ${String(Math.round(waitBudgetMs / 60_000))} min) — ${first.message}`,
  });
  const deadlineMs = deps.nowMs() + waitBudgetMs;
  for (let remainingMs = waitBudgetMs; remainingMs > 0; remainingMs = deadlineMs - deps.nowMs()) {
    await deps.wait({ ms: Math.min(PRUNE_LOCK_POLL_MS, remainingMs) });
    const next = attempt({ deps, retry: true });
    if (next.kind !== "contended") {
      return next;
    }
  }
  return attempt({ deps, retry: true });
}
