/**
 * An age that cannot be compared with the threshold, because an instant is unreadable or the threshold is not a
 * usable number: a live holder is refused and named, a dead one is still recovered, and a positive infinity is
 * read as a never-stale DECLARATION rather than as a broken lock.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { home, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("an age that cannot be compared with the threshold", () => {
  it("refuses a live holder rather than taking its lock over, naming the unreadable instant", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    expect(first.isOk()).toBe(true);
    const heldFile = lockFileIn({ h });

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "not an instant" });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain(
      "the instant of this attempt, not an instant, is not a readable instant",
    );
    expect(second._unsafeUnwrapErr()).toContain(String(process.pid));
    expect(lockFileIn({ h })).toBe(heldFile);
  });

  it("refuses a live holder whose own recorded instant is unreadable", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "whenever", pid: process.pid }));

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain("its own acquiredAtIso, whenever, is not a readable instant");
  });

  it("still recovers a lock whose holder is dead, whatever the instants say", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const dead = spawnSync("true", [], { stdio: "ignore" }).pid;
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "whenever", pid: dead }));

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(second.isOk()).toBe(true);
    expect(second._unsafeUnwrap().stoleFromPid).toBe(dead);
  });

  it("refuses a live holder when the threshold itself is not a finite number", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const heldFile = lockFileIn({ h });

    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:05Z",
      staleAfterMs: Number.NaN,
    });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain(
      "the stale threshold it was given, NaN, is neither a finite number of milliseconds nor the positive infinity that declares a lease never stale",
    );
    expect(lockFileIn({ h })).toBe(heldFile);
  });

  it("refuses a live holder under an infinite threshold as a DECLARATION, never as a broken lock", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const heldFile = lockFileIn({ h });

    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T09:00:00Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain(
      `held by pid ${String(process.pid)} since 2026-08-11T00:00:00Z (32400000ms old, under a lease declared never to go stale while its holder lives, and the holder answered signal 0 — it was ALIVE when checked at 2026-08-11T09:00:00Z, so this is contention rather than a lock left behind by a dead process; wait for the holder to finish)`,
    );
    expect(second._unsafeUnwrapErr()).not.toContain("could not be compared");
    expect(lockFileIn({ h })).toBe(heldFile);
  });

  it("still takes over a DEAD holder under an infinite threshold, whatever its age", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const dead = spawnSync("true", [], { stdio: "ignore" }).pid;
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "2026-08-11T00:00:00Z", pid: dead }));

    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:05Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(second.isOk()).toBe(true);
    expect(second._unsafeUnwrap().stoleFromPid).toBe(dead);
  });

  it("refuses a live holder under a NEGATIVE infinity, which declares nothing and is still unusable", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const heldFile = lockFileIn({ h });

    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:05Z",
      staleAfterMs: Number.NEGATIVE_INFINITY,
    });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain(
      "the stale threshold it was given, -Infinity, is neither a finite number of milliseconds nor the positive infinity that declares a lease never stale",
    );
    expect(lockFileIn({ h })).toBe(heldFile);
  });

  it("names the unreadable INSTANT, not the threshold, when a never-stale lease meets a corrupt record", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "whenever", pid: process.pid }));

    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:05Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain("its own acquiredAtIso, whenever, is not a readable instant");
    expect(second._unsafeUnwrapErr()).not.toContain("never to go stale");
  });
});
