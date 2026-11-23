/**
 * A holder the kernel reports gone makes its lock stale at once, whatever its age, while a live holder is still
 * judged by age alone.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { home, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("a holder the kernel says is gone is stale at once", () => {
  /**
   * A pid that is genuinely finished: spawned, exited, and reaped by `spawnSync` before it returns. Real
   * rather than a large invented number, so this tests ESRCH from the kernel and not an EINVAL for a pid
   * that could never have existed.
   */
  function deadPid(): number {
    const child = spawnSync("true", [], { stdio: "ignore" });
    return child.pid;
  }

  it("takes over a lock well inside the stale threshold when its holder has exited", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    const file = lockFileIn({ h });
    const held = JSON.parse(readFileSync(file, "utf8")) as { acquiredAtIso: string; pid: number };
    writeFileSync(file, JSON.stringify({ acquiredAtIso: held.acquiredAtIso, pid: deadPid() }));

    // Five seconds old against a fifteen-minute threshold: age alone would refuse this.
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(second.isOk()).toBe(true);
  });

  it("still refuses a lock inside the threshold whose holder IS alive", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain("under the");
  });

  it("takes over an aged lock whose holder is alive, exactly as before", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:20:00Z" });

    expect(second.isOk()).toBe(true);
  });
});
