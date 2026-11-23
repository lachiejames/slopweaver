import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { takeReadLock } from "../../../orgHealth/readLock.js";
import { runtimeLockDir } from "../../../stateRuntime.js";

/** The wall-clock instant every attempt is judged at. */
const NOW_ISO = "2026-10-04T09:00:00.000Z";

describe("takeReadLock", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-lock-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("takes the lock in the runtime directory, writing nothing under the home, and frees it on release", () => {
    const first = unwrap(takeReadLock({ home, nowIso: NOW_ISO }));
    first.release();
    const second = unwrap(takeReadLock({ home, nowIso: NOW_ISO }));
    second.release();
    expect([existsSync(join(home, "org-health")), existsSync(join(home, "locks"))]).toEqual([false, false]);
  });

  it("refuses with READ_UNDER_WAY while another read holds it", () => {
    const held = unwrap(takeReadLock({ home, nowIso: NOW_ISO }));
    const refused = unwrapErr(takeReadLock({ home, nowIso: NOW_ISO }));
    held.release();
    expect(refused.code).toBe("READ_UNDER_WAY");
  });

  it("refuses with READ_LOCK_UNAVAILABLE when the home has no real path", () => {
    const refused = unwrapErr(takeReadLock({ home: join(home, "absent"), nowIso: NOW_ISO }));
    expect([refused.code, refused.message]).toEqual([
      "READ_LOCK_UNAVAILABLE",
      expect.stringContaining("has no real path"),
    ]);
  });

  it("refuses with READ_LOCK_UNAVAILABLE rather than throwing when the lock directory is a file", () => {
    const directory = unwrap(runtimeLockDir({ home }));
    mkdirSync(join(directory, ".."), { recursive: true });
    writeFileSync(directory, "not a directory");
    try {
      const refused = unwrapErr(takeReadLock({ home, nowIso: NOW_ISO }));
      expect(refused.code).toBe("READ_LOCK_UNAVAILABLE");
    } finally {
      rmSync(directory, { force: true });
    }
  });
});
