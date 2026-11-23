/**
 * Waiting for the operation lock over injected seams: no real lock, no real clock. What is asserted is the
 * property the hand-rolled retry loop had to get right by hand — every attempt is a WHOLE acquisition, the
 * handle comes back the moment one succeeds, and a timeout hands back the last refusal rather than a
 * synthesised one.
 */
import { describe, expect, it } from "vitest";

import type { OperationLockResult } from "../../../admit/operationLock.js";
import { acquireOperationLockWaiting } from "../../../admit/operationLockWait.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { LOCAL_WAIT_SCHEDULE_MS, type WaitClock } from "../../../wait/loop.js";

/** A clock that advances only when the wait sleeps, recording every sleep. */
function fakeClock(): { clock: WaitClock; slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    clock: {
      nowMs: () => now,
      sleep: ({ ms }) => {
        slept.push(ms);
        now += ms;
        return Promise.resolve();
      },
    },
    slept,
  };
}

/** An acquire that refuses `refusals` times and then hands over a handle, recording the instants it saw. */
function acquireAfter({ refusals }: { refusals: number }): {
  acquire: (input: { home: string; key: string; nowIso: string }) => OperationLockResult;
  instants: string[];
  released: string[];
} {
  const instants: string[] = [];
  const released: string[] = [];
  let attempts = 0;
  return {
    acquire: ({ nowIso }) => {
      instants.push(nowIso);
      attempts += 1;
      if (attempts <= refusals) {
        return err(`held by pid 4242 since 2026-09-20T00:00:00.000Z (attempt ${String(attempts)})`);
      }
      return ok({
        release: () => {
          released.push(nowIso);
        },
        stillHeld: () => true,
        stoleFromPid: undefined,
      });
    },
    instants,
    released,
  };
}

describe("acquireOperationLockWaiting", () => {
  it("hands back the handle on the first attempt when the lock is free", async () => {
    const { acquire, instants } = acquireAfter({ refusals: 0 });
    const { clock, slept } = fakeClock();
    const result = await acquireOperationLockWaiting({
      acquire,
      clock,
      emit: () => {},
      home: "/home",
      key: "o/r",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      timeoutSeconds: 540,
    });
    expect(result.isOk()).toBe(true);
    expect(instants.length).toBe(1);
    expect(slept).toEqual([]);
    unwrap(result).release();
  });

  it("re-attempts on the local schedule and returns the handle the moment one succeeds", async () => {
    const { acquire, instants } = acquireAfter({ refusals: 3 });
    const { clock, slept } = fakeClock();
    const result = await acquireOperationLockWaiting({
      acquire,
      clock,
      emit: () => {},
      home: "/home",
      key: "o/r",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      timeoutSeconds: 540,
    });
    expect(result.isOk()).toBe(true);
    expect(instants.length).toBe(4);
    expect(slept).toEqual(LOCAL_WAIT_SCHEDULE_MS.slice(0, 3));
  });

  it("reads the instant again per attempt, because each attempt records its own in the lock file", async () => {
    const { acquire, instants } = acquireAfter({ refusals: 2 });
    const { clock } = fakeClock();
    let tick = 0;
    await acquireOperationLockWaiting({
      acquire,
      clock,
      emit: () => {},
      home: "/home",
      key: "o/r",
      nowIso: () => {
        tick += 1;
        return `2026-09-20T00:00:0${String(tick)}.000Z`;
      },
      timeoutSeconds: 540,
    });
    expect(instants).toEqual(["2026-09-20T00:00:01.000Z", "2026-09-20T00:00:02.000Z", "2026-09-20T00:00:03.000Z"]);
  });

  it("suppresses an identical waiting line, so only a CHANGED one reaches the caller", async () => {
    const { acquire } = acquireAfter({ refusals: 0 });
    const lines: string[] = [];
    const { clock } = fakeClock();
    let attempts = 0;
    await acquireOperationLockWaiting({
      acquire: (input) => {
        attempts += 1;
        if (attempts <= 3) {
          return err("held by pid 4242 since 2026-09-20T00:00:00.000Z");
        }
        return acquire(input);
      },
      clock,
      emit: (line) => lines.push(line),
      home: "/home",
      key: "o/r",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      timeoutSeconds: 540,
    });
    expect(lines).toEqual(["waiting for the o/r operation lock: held by pid 4242 since 2026-09-20T00:00:00.000Z"]);
  });

  it("forwards a declared stale threshold to every attempt, and none when the caller declared none", async () => {
    const declared: (number | undefined)[] = [];
    const undeclared: (number | undefined)[] = [];
    const { clock } = fakeClock();
    const recordInto =
      ({ into }: { into: (number | undefined)[] }) =>
      (input: { home: string; key: string; nowIso: string; staleAfterMs?: number }): OperationLockResult => {
        into.push(input.staleAfterMs);
        return into.length < 2
          ? err("held by pid 4242")
          : ok({ release: () => {}, stillHeld: () => true, stoleFromPid: undefined });
      };
    await acquireOperationLockWaiting({
      acquire: recordInto({ into: declared }),
      clock,
      emit: () => {},
      home: "/home",
      key: "browser-relay",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
      timeoutSeconds: 540,
    });
    await acquireOperationLockWaiting({
      acquire: recordInto({ into: undeclared }),
      clock,
      emit: () => {},
      home: "/home",
      key: "o/r",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      timeoutSeconds: 540,
    });
    expect(declared).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
    expect(undeclared).toEqual([undefined, undefined]);
  });

  it("hands back the LAST attempt's own refusal when the deadline arrives first", async () => {
    const { acquire } = acquireAfter({ refusals: 100 });
    const { clock } = fakeClock();
    const result = await acquireOperationLockWaiting({
      acquire,
      clock,
      emit: () => {},
      home: "/home",
      key: "o/r",
      nowIso: () => "2026-09-20T00:00:00.000Z",
      timeoutSeconds: 3,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toBe("held by pid 4242 since 2026-09-20T00:00:00.000Z (attempt 3)");
  });
});
