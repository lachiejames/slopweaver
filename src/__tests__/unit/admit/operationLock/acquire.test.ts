/**
 * `acquireOperationLock` on its ordinary paths: a fresh grant, a refusal naming a live holder, release and
 * re-acquisition, distinct keys and tokens, an aged takeover, and a release that warns rather than throws.
 */
import { chmodSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { home, lockDirIn, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("acquireOperationLock", () => {
  it("grants a fresh key immediately", () => {
    const result = acquireOperationLock({ home: home(), key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    expect(result.isOk()).toBe(true);
  });

  it("refuses a key already held within the stale threshold", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    expect(first.isOk()).toBe(true);
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });
    expect(second.isOk()).toBe(false);
  });

  it("names the holder and its age in the refusal reason", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected the first acquisition to succeed");
    }
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });
    if (second.isOk()) {
      throw new Error("expected the second acquisition to be refused");
    }
    expect(second.error).toContain(String(process.pid));
    expect(second.error).toContain("5000ms old");
  });

  it("says the holder is still running, so contention is never read as a lock left behind by a dead process", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected the first acquisition to succeed");
    }
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });
    if (second.isOk()) {
      throw new Error("expected the second acquisition to be refused");
    }
    expect(second.error).toContain("answered signal 0");
    expect(second.error).toContain("it was ALIVE when checked at");
  });

  it("allows a re-acquisition after release", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected the first acquisition to succeed");
    }
    first.value.release();
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });
    expect(second.isOk()).toBe(true);
  });

  it("does not let two different keys collide", () => {
    const h = home();
    const a = acquireOperationLock({ home: h, key: "owner/repo-a", nowIso: "2026-08-11T00:00:00Z" });
    const b = acquireOperationLock({ home: h, key: "owner/repo-b", nowIso: "2026-08-11T00:00:00Z" });
    expect(a.isOk()).toBe(true);
    expect(b.isOk()).toBe(true);
  });

  it("takes over a lock older than the stale threshold, reporting who it took it from", () => {
    const h = home();
    const first = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:00Z",
      staleAfterMs: 1000,
    });
    if (!first.isOk()) {
      throw new Error("expected the first acquisition to succeed");
    }
    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:02Z",
      staleAfterMs: 1000,
    });
    if (!second.isOk()) {
      throw new Error("expected the stale lock to be taken over");
    }
    expect(second.value.stoleFromPid).toBe(process.pid);
  });

  it("does not take over a lock still within the stale threshold", () => {
    const h = home();
    const first = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:00Z",
      staleAfterMs: 60000,
    });
    expect(first.isOk()).toBe(true);
    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:02Z",
      staleAfterMs: 60000,
    });
    expect(second.isOk()).toBe(false);
  });

  it("reports no stolen pid on an ordinary fresh acquisition", () => {
    const result = acquireOperationLock({ home: home(), key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!result.isOk()) {
      throw new Error("expected acquisition to succeed");
    }
    expect(result.value.stoleFromPid).toBeUndefined();
  });

  it("gives two acquisitions in one process different tokens, whatever the random half does", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    const firstToken = lockFileIn({ h });
    first._unsafeUnwrap().release();
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });
    expect(second.isOk()).toBe(true);

    expect(lockFileIn({ h })).not.toBe(firstToken);
  });

  it("release is a no-op the second time", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected acquisition to succeed");
    }
    first.value.release();
    expect(() => first.value.release()).not.toThrow();
  });

  it("never throws on a genuine unlink failure, and warns on stderr instead of silently discarding it", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected acquisition to succeed");
    }
    const lockDir = lockDirIn({ h });
    chmodSync(lockDir, 0o555); // removes write permission, so unlinking the token file inside it fails
    const originalWrite = process.stderr.write.bind(process.stderr);
    const written: string[] = [];
    process.stderr.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      expect(() => first.value.release()).not.toThrow();
    } finally {
      process.stderr.write = originalWrite;
      chmodSync(lockDir, 0o755);
    }
    expect(written.some((line) => line.includes("could not release"))).toBe(true);
  });

  it("writes a failed release's warning to the caller's own writer when it passes one, and nothing else", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    if (!first.isOk()) {
      throw new Error("expected the first acquisition to succeed");
    }
    const lockDir = lockDirIn({ h });
    chmodSync(lockDir, 0o555); // removes write permission, so unlinking the token file inside it fails
    const warned: string[] = [];
    try {
      first.value.release({ warn: ({ line }) => warned.push(line) });
    } finally {
      chmodSync(lockDir, 0o755);
    }
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`could not release the stack operation lock at ${lockDir}`);
  });
});
