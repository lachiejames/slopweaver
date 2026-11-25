/**
 * The Recovery check's lock: two checks never open throwaway sessions beside each other, and a `fleet resume` pass
 * holding its own lock never holds a check off.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireFleetLock, acquireFleetRecoverLock } from "../../../fleet/locks.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-11-25T10:00:00.000Z";

const dirs: string[] = [];

/** A throwaway home this file removes after every test. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "recover-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("acquireFleetRecoverLock", () => {
  it("refuses a second check while the first holds it, and frees it on release", () => {
    const home = freshHome();
    const first = unwrap(acquireFleetRecoverLock({ home, nowIso: NOW }));
    expect(first.stillHeld()).toBe(true);
    expect(unwrapErr(acquireFleetRecoverLock({ home, nowIso: NOW })).code).toBe("LOCK_HELD");
    first.release();
    const second = unwrap(acquireFleetRecoverLock({ home, nowIso: NOW }));
    expect(second.stillHeld()).toBe(true);
    second.release();
  });

  it("is a key of its own, so a held resume lock does not hold a check off", () => {
    const home = freshHome();
    const resume = unwrap(acquireFleetLock({ home, nowIso: NOW }));
    const recover = unwrap(acquireFleetRecoverLock({ home, nowIso: NOW }));
    expect(recover.stillHeld()).toBe(true);
    recover.release();
    resume.release();
  });
});
