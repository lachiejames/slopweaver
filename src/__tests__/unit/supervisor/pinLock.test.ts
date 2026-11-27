/**
 * The supervisor-pin lock over real throwaway homes: one key per home, so a second pin in the same home refuses while
 * the first holds it, and two homes never contend.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireRuntimeLock } from "../../../admit/runtimeLock.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { acquireSupervisorPinLock } from "../../../supervisor/pinLock.js";

const NOW = "2026-11-27T10:00:00.000Z";

const dirs: string[] = [];

/** A throwaway home this file removes after every test. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pin-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("acquireSupervisorPinLock", () => {
  it("refuses a second holder in the same home, and frees on release", () => {
    const home = freshHome();
    const first = unwrap(acquireSupervisorPinLock({ home, nowIso: NOW }));
    expect(unwrapErr(acquireSupervisorPinLock({ home, nowIso: NOW })).code).toBe("LOCK_CONTENDED");
    first.release();
    const third = unwrap(acquireSupervisorPinLock({ home, nowIso: NOW }));
    expect(third.stillHeld()).toBe(true);
    third.release();
  });

  it("is the supervisor-pin key, so a runtime lock under that key holds it off", () => {
    const home = freshHome();
    const other = unwrap(acquireRuntimeLock({ home, key: "supervisor-pin", nowIso: NOW }));
    expect(unwrapErr(acquireSupervisorPinLock({ home, nowIso: NOW })).code).toBe("LOCK_CONTENDED");
    other.release();
  });

  it("does not contend across two homes", () => {
    const first = unwrap(acquireSupervisorPinLock({ home: freshHome(), nowIso: NOW }));
    const second = unwrap(acquireSupervisorPinLock({ home: freshHome(), nowIso: NOW }));
    expect(second.stillHeld()).toBe(true);
    second.release();
    first.release();
  });
});
