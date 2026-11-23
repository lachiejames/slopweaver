/**
 * How one `--apply` meets another: an automatic run steps aside, an asked-for drain waits for the holder, and a
 * lock no rerun clears is never waited out.
 */
import { describe, expect, it } from "vitest";

import type { DetailedOperationLockResult, OperationLockHandle } from "../../../admit/operationLock.js";
import { OperationLockAcquireErrors } from "../../../admit/operationLockHeld.js";
import {
  acquirePruneApplyLock,
  PRUNE_LOCK_POLL_MS,
  type PruneApplyLockOutcome,
} from "../../../cli/commands/worktree/pruneApplyLock.js";
import { err, ok } from "../../../lib/result.js";

const HANDLE: OperationLockHandle = { release: () => undefined, stillHeld: () => true, stoleFromPid: undefined };
const HELD: DetailedOperationLockResult = ok(HANDLE);
const CONTENDED: DetailedOperationLockResult = err(
  OperationLockAcquireErrors.contended({ message: "held by pid 22327 since 2026-11-09T11:44:47.305Z" }),
);
const REFUSED: DetailedOperationLockResult = err(OperationLockAcquireErrors.refused({ message: "unwritable home" }));

/**
 * Drive one acquisition over a scripted sequence of attempts, on a clock only the waits advance.
 *
 * @param attempts what each successive attempt answers; the last repeats once the script runs out
 * @param ifIdle whether the run steps aside
 * @param waitBudgetMs how long a waiting run may wait
 * @returns the outcome, every wait asked for, how many attempts ran and what was announced
 */
async function run({
  attempts,
  ifIdle,
  waitBudgetMs = 60_000,
}: {
  attempts: readonly DetailedOperationLockResult[];
  ifIdle: boolean;
  waitBudgetMs?: number;
}): Promise<{
  readonly outcome: PruneApplyLockOutcome;
  readonly waits: readonly number[];
  readonly tries: number;
  readonly retries: readonly boolean[];
  readonly announced: readonly string[];
}> {
  let clockMs = 0;
  let tries = 0;
  const retries: boolean[] = [];
  const waits: number[] = [];
  const announced: string[] = [];
  const outcome = await acquirePruneApplyLock({
    deps: {
      acquire: ({ retry }) => {
        const answer = attempts[Math.min(tries, attempts.length - 1)]!;
        tries += 1;
        retries.push(retry);
        return answer;
      },
      announce: ({ line }) => {
        announced.push(line);
      },
      nowMs: () => clockMs,
      wait: ({ ms }) => {
        waits.push(ms);
        clockMs += ms;
        return Promise.resolve();
      },
    },
    ifIdle,
    waitBudgetMs,
  });
  return { announced, outcome, retries, tries, waits };
}

describe("acquirePruneApplyLock", () => {
  it("holds the lock on the first attempt when nobody else has it, waiting for nothing", async () => {
    const { outcome, waits, announced } = await run({ attempts: [HELD], ifIdle: false });
    expect(outcome.kind).toBe("held");
    expect(waits).toEqual([]);
    expect(announced).toEqual([]);
  });

  it("steps aside at once under --if-idle, naming the holder", async () => {
    const { outcome, tries, waits } = await run({ attempts: [CONTENDED], ifIdle: true });
    expect(outcome).toEqual({ kind: "contended", message: "held by pid 22327 since 2026-11-09T11:44:47.305Z" });
    expect(tries).toBe(1);
    expect(waits).toEqual([]);
  });

  it("waits for a holder without --if-idle and takes the lock the attempt after it is let go", async () => {
    const { outcome, tries, waits, announced } = await run({
      attempts: [CONTENDED, CONTENDED, HELD],
      ifIdle: false,
    });
    expect(outcome.kind).toBe("held");
    expect(tries).toBe(3);
    expect(waits).toEqual([PRUNE_LOCK_POLL_MS, PRUNE_LOCK_POLL_MS]);
    expect(announced).toEqual([
      "worktree prune: another --apply holds the lock, so this one waits for it (up to 1 min) — held by pid 22327 since 2026-11-09T11:44:47.305Z",
    ]);
  });

  it("gives up as contended once the wait budget is spent, never waiting past it", async () => {
    const { outcome, waits } = await run({ attempts: [CONTENDED], ifIdle: false, waitBudgetMs: 40_000 });
    expect(outcome.kind).toBe("contended");
    expect(waits).toEqual([15_000, 15_000, 10_000]);
  });

  it("asks only the first attempt to apply the lease, so waiting never ages a live holder into a takeover", async () => {
    const { retries } = await run({ attempts: [CONTENDED, CONTENDED, HELD], ifIdle: false });
    expect(retries).toEqual([false, true, true]);
  });

  it("never waits out a refusal, whichever mode", async () => {
    const asked = await run({ attempts: [REFUSED], ifIdle: false });
    expect(asked.outcome).toEqual({ kind: "refused", message: "unwritable home" });
    expect(asked.waits).toEqual([]);
    const midWait = await run({ attempts: [CONTENDED, REFUSED], ifIdle: false });
    expect(midWait.outcome).toEqual({ kind: "refused", message: "unwritable home" });
    expect(midWait.waits).toEqual([PRUNE_LOCK_POLL_MS]);
  });
});
