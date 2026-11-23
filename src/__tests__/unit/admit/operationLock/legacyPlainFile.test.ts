/**
 * A lock left in the previous shape, a plain FILE carrying the record where the lock directory now goes: cleared
 * when its holder is dead, refused while it lives, and refused as unreadable when its record does not parse.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { home, lockDirIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("a plain-file lock left by the previous shape", () => {
  /** Seed the legacy shape by hand: the lock path is a FILE carrying the record, not a directory. */
  function seedLegacy({ h, pid }: { h: string; pid: number }): string {
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    const lockDir = lockDirIn({ h });
    first._unsafeUnwrap().release();
    writeFileSync(lockDir, JSON.stringify({ acquiredAtIso: "2026-08-11T00:00:00Z", pid }));
    return lockDir;
  }

  it("is cleared and replaced by a directory when its holder is dead", () => {
    const h = home();
    const dead = spawnSync("true", [], { stdio: "ignore" }).pid;
    const path = seedLegacy({ h, pid: dead });
    expect(statSync(path).isFile()).toBe(true);

    const result = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().stoleFromPid).toBe(dead);
    expect(statSync(path).isDirectory()).toBe(true);
    expect(readdirSync(path)).toHaveLength(1);
  });

  it("is refused, naming the holder, while its holder is alive and under the threshold", () => {
    const h = home();
    seedLegacy({ h, pid: process.pid });

    const result = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toContain(`held by pid ${String(process.pid)}`);
    expect(result._unsafeUnwrapErr()).toContain("5000ms old");
  });

  // The reader that judges this shape classifies its own read failure — a path a peer unlinked or replaced
  // between the readdir that found a file and the readFile of it is gone round again rather than refused
  // (see `operationLockState.ts`'s readPlainFileLock). A record that does not PARSE is the other side of that line and must
  // still refuse: it is content rather than shape, and going round again on it would spin on a corrupt lock
  // until the round bound gave up, reporting contention that was never there.
  it("whose record does not parse is still refused as unreadable, never treated as a path in motion", () => {
    const h = home();
    const path = seedLegacy({ h, pid: process.pid });
    writeFileSync(path, "{ not json");

    const result = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(result.isOk()).toBe(false);
    expect(result._unsafeUnwrapErr()).toContain("could not be read to check its age");
    expect(statSync(path).isFile()).toBe(true);
  });
});
