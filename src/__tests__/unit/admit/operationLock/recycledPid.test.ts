/**
 * A holder is its pid AND that process's start: a recorded start that no longer matches makes a recycled pid a
 * dead holder, a record with no start stamp ages out on the ordinary window, and each acquire records its own.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { acquireOperationLock, type OperationLockResult } from "../../../../admit/operationLock.js";
import { processStartOf } from "../../../../talk/relayLease.js";
import { home, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("a holder is its pid AND that process's start, so a recycled pid is a dead holder", () => {
  it("takes over a never-stale lease whose pid another process has since been given", () => {
    const h = home();
    const lease = { home: h, key: "hand-step-register", staleAfterMs: Number.POSITIVE_INFINITY };
    expect(acquireOperationLock({ ...lease, nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const recycled = { acquiredAtIso: "2026-08-11T00:00:00Z", pid: process.ppid, start: "Thu Jan  1 00:00:00 1970" };
    writeFileSync(lockFileIn({ h }), JSON.stringify(recycled));

    const second = acquireOperationLock({ ...lease, nowIso: "2026-08-11T00:00:05Z" });

    expect(second._unsafeUnwrap().stoleFromPid).toBe(process.ppid);
  });

  it("refuses that lease while the pid's start still matches the one recorded", () => {
    const h = home();
    const lease = { home: h, key: "hand-step-register", staleAfterMs: Number.POSITIVE_INFINITY };
    expect(acquireOperationLock({ ...lease, nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const start = processStartOf({ pid: process.ppid }).start;
    expect(start).toBeDefined();
    writeFileSync(
      lockFileIn({ h }),
      JSON.stringify({ acquiredAtIso: "2026-08-11T00:00:00Z", pid: process.ppid, start }),
    );

    const second = acquireOperationLock({ ...lease, nowIso: "2026-08-11T09:00:00Z" });

    expect(second._unsafeUnwrapErr()).toContain(`held by pid ${String(process.ppid)} since 2026-08-11T00:00:00Z`);
  });

  /** A never-stale lease left with a record carrying a live pid and no start stamp, then contended at `nowIso`. */
  function unstampedLeaseAt({ nowIso }: { nowIso: string }): OperationLockResult {
    const h = home();
    const lease = { home: h, key: "hand-step-register", staleAfterMs: Number.POSITIVE_INFINITY };
    expect(acquireOperationLock({ ...lease, nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "2026-08-11T00:00:00Z", pid: process.ppid }));
    return acquireOperationLock({ ...lease, nowIso });
  }

  it("ages out a never-stale lease whose record carries no start stamp, once past the ordinary window", () => {
    expect(unstampedLeaseAt({ nowIso: "2026-08-11T00:16:00Z" })._unsafeUnwrap().stoleFromPid).toBe(process.ppid);
  });

  it("refuses that lease while it is younger than the ordinary window", () => {
    expect(unstampedLeaseAt({ nowIso: "2026-08-11T00:05:00Z" })._unsafeUnwrapErr()).toContain(
      `held by pid ${String(process.ppid)} since 2026-08-11T00:00:00Z (300000ms old, under the 900000ms stale threshold`,
    );
  });

  it("records this process's own start beside its pid", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    expect(JSON.parse(readFileSync(lockFileIn({ h }), "utf8"))).toEqual({
      acquiredAtIso: "2026-08-11T00:00:00Z",
      pid: process.pid,
      start: processStartOf({ pid: process.pid }).start,
    });
  });
});
