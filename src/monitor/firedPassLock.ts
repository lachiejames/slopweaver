/**
 * One FIRED monitor pass per home at a time, FENCED.
 *
 * A fired pass reads the open cards, evaluates, then posts — and `appendHandRow`'s lock covers only the append. Two
 * passes that both read "no card open" before either posted would each post: the second finds the first's step id
 * spent and allocates occurrence `.2` (`./passPost.ts`), and each raises its own note. The producers that make it real are two: `claude watch` fires the plan-fault monitor on
 * every keep-alive tick, while the supervisor tick fires it too. So the whole fired pass — Done reconciliation, open-card
 * read, evaluation, posts and settles — holds this one lock, and a rehearsal, which writes nothing, never takes it.
 *
 * The lease ages out, and the pass is FENCED rather than trusted. Both alternatives were tried against a review. An
 * age takeover alone is unfenced, so a slow pass overtaken mid-way posts from its stale open-card read beside the new
 * holder. A lease that never ages out while its holder lives lets one hung pass
 * refuse every later fired pass of EVERY monitor in the home, so a fault is never carded at all.
 * So a pass checks {@link FiredPassLease.stillHeld} before each reading's writes (`./pass.ts`), and one that lost its
 * lease writes nothing more. A dead holder is reclaimed at once by its pid (`../admit/operationLockHeld.ts`).
 *
 * A fired pass is local reads plus a handful of appends, so a contended caller WAITS a bounded while rather than
 * skipping: a skipped pass is a fault seen and not floated until the next tick.
 */
import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLockDetailed } from "../admit/operationLock.js";

/** The lock's key under `$SLOPWEAVER_HOME`'s operation locks. */
const FIRED_PASS_LOCK_KEY = "monitor-fired-pass";

/**
 * How long a held fired-pass lock may sit before a later pass takes it over: far past any real pass, short enough
 * that a hung one does not stop every monitor's lane for long. The overtaken pass is fenced off its remaining writes.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** A held fired-pass lease: its release, and the fence a pass checks before each write. */
export interface FiredPassLease {
  readonly release: () => void;
  /** False once a later pass took the aged-out lease over, or it was released: write nothing more. */
  readonly stillHeld: () => boolean;
}

/**
 * Hold the fired-pass lock, waiting while another live pass holds it.
 *
 * @param home the state home the lock lives under
 * @param now the clock each attempt is stamped at
 * @param wait how a contended attempt waits before the next
 * @param attempts how many tries before giving up
 * @param intervalMs how long each wait is
 * @returns the lease, or why this pass does not hold the lock
 */
export async function holdFiredPassLock({
  attempts = 60,
  home,
  intervalMs = 500,
  now,
  wait,
}: {
  attempts?: number;
  home: string;
  intervalMs?: number;
  now: () => string;
  wait: (request: { ms: number }) => Promise<void>;
}): Promise<Result<FiredPassLease, string>> {
  let reason = "the fired-pass lock was never tried";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lock = acquireOperationLockDetailed({
      home,
      key: FIRED_PASS_LOCK_KEY,
      nowIso: now(),
      staleAfterMs: STALE_AFTER_MS,
    });
    if (lock.isOk()) {
      return ok({ release: lock.value.release, stillHeld: lock.value.stillHeld });
    }
    if (lock.error.code !== "LOCK_CONTENDED") {
      return err(`the fired-pass lock was refused: ${lock.error.message}`);
    }
    reason = lock.error.message;
    await wait({ ms: intervalMs });
  }
  return err(`another fired monitor pass held the lock through every attempt: ${reason}`);
}
