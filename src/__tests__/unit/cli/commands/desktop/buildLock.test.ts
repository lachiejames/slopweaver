/**
 * `holdBuildLock` over a scripted lock and a clock that moves only when it pauses: it takes a free lock at once,
 * waits out a held one saying so once, and gives up with the lock's own reason once the bound is spent.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import type { OperationLockHandle, OperationLockResult } from "../../../../../admit/operationLock.js";
import { holdBuildLock } from "../../../../../cli/commands/desktop/buildLock.js";
import { PREBUILD_POLL_MS, PREBUILD_WAIT_MS } from "../../../../../desktop/stagedBuild.js";

const HANDLE: OperationLockHandle = { release: () => {}, stillHeld: () => true, stoleFromPid: undefined };
const HELD = "held by pid 4242 since 2026-10-10T18:00:00Z";

/** Hold the lock with `answers` given in turn, the last repeating, on a clock that moves only when it pauses. */
async function holdWith({ answers }: { answers: readonly OperationLockResult[] }): Promise<{
  result: Awaited<ReturnType<typeof holdBuildLock>>;
  attempts: number;
  waited: string[];
  pausedMs: number;
}> {
  let attempts = 0;
  let now = 0;
  const waited: string[] = [];
  const result = await holdBuildLock({
    acquire: () => {
      const answer = answers[Math.min(attempts, answers.length - 1)]!;
      attempts += 1;
      return answer;
    },
    nowMs: () => now,
    pause: async ({ ms }) => {
      now += ms;
    },
    waiting: ({ detail }) => {
      waited.push(detail);
    },
  });
  return { attempts, pausedMs: now, result, waited };
}

describe("holdBuildLock", () => {
  it("takes a free lock at once, without waiting", async () => {
    const { result, attempts, waited } = await holdWith({ answers: [ok(HANDLE)] });
    expect(unwrap(result)).toBe(HANDLE);
    expect(attempts).toBe(1);
    expect(waited).toEqual([]);
  });

  it("waits out a held lock, saying so once, and takes it when it frees", async () => {
    const { result, attempts, waited, pausedMs } = await holdWith({ answers: [err(HELD), err(HELD), ok(HANDLE)] });
    expect(unwrap(result)).toBe(HANDLE);
    expect(attempts).toBe(3);
    expect(waited).toEqual([HELD]);
    expect(pausedMs).toBe(2 * PREBUILD_POLL_MS);
  });

  it("gives up with the lock's own reason once the bound is spent", async () => {
    const { result, pausedMs } = await holdWith({ answers: [err(HELD)] });
    expect(unwrapErr(result)).toBe(HELD);
    expect(pausedMs).toBe(PREBUILD_WAIT_MS);
  });
});
