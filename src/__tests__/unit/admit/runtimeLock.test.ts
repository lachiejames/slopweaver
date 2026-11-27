/**
 * The process-lifetime runtime lock over real throwaway homes: a second live holder refuses with the operation lock's
 * own typed contention, release frees it, and a home with no real path refuses as a runtime-directory fault.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireRuntimeLock } from "../../../admit/runtimeLock.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-11-27T10:00:00.000Z";

const dirs: string[] = [];

/** A throwaway home this file removes after every test. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "runtime-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("acquireRuntimeLock", () => {
  it("refuses a second live holder as LOCK_CONTENDED naming this pid, and frees on release", () => {
    const home = freshHome();
    const first = unwrap(acquireRuntimeLock({ home, key: "acme-key", nowIso: NOW }));
    const refused = unwrapErr(acquireRuntimeLock({ home, key: "acme-key", nowIso: NOW }));
    expect(refused.code).toBe("LOCK_CONTENDED");
    expect(refused.message).toContain(`pid ${String(process.pid)}`);
    first.release();
    const second = unwrap(acquireRuntimeLock({ home, key: "acme-key", nowIso: NOW }));
    expect(second.stillHeld()).toBe(true);
    second.release();
  });

  it("refuses a home with no real path as a runtime-directory fault", () => {
    const home = join(freshHome(), "absent");
    const refused = unwrapErr(acquireRuntimeLock({ home, key: "acme-key", nowIso: NOW }));
    expect(refused.code).toBe("RUNTIME_DIRECTORY_UNAVAILABLE");
    expect(refused.message).toContain(`the home ${home} has no real path`);
  });
});
