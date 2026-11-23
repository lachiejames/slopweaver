/**
 * `acquireOperationLockDetailed` types each refusal by whether running again can clear it: LOCK_CONTENDED for a
 * live holder whose hold ends, LOCK_REFUSED for every state nothing says will change, and a staging fault returned
 * rather than thrown, while the string form still throws it.
 */
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquireOperationLock,
  acquireOperationLockDetailed,
  type DetailedOperationLockResult,
} from "../../../../admit/operationLock.js";
import { operationLockDir } from "../../../../admit/operationLockPath.js";
import { unwrapErr } from "../../../../lib/result.js";
import { home, lockDirIn, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("the detailed refusal says whether running again can clear it", () => {
  it("types a live holder within its threshold as LOCK_CONTENDED, with the same words the string form carries", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    const detailed = unwrapErr(
      acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" }),
    );
    const plain = unwrapErr(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" }));

    expect(detailed.code).toBe("LOCK_CONTENDED");
    expect(detailed.message).toBe(
      `held by pid ${String(process.pid)} since 2026-08-11T00:00:00Z (5000ms old, under the 900000ms stale threshold, and the holder answered signal 0 — it was ALIVE when checked at 2026-08-11T00:00:05Z, so this is contention rather than a lock left behind by a dead process)`,
    );
    expect(plain).toBe(detailed.message);
  });

  it("types a live holder under a never-stale lease as LOCK_CONTENDED, since it ends when the holder does", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);

    const detailed = unwrapErr(
      acquireOperationLockDetailed({
        home: h,
        key: "owner/repo",
        nowIso: "2026-08-11T09:00:00Z",
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    );

    expect(detailed.code).toBe("LOCK_CONTENDED");
    expect(detailed.message).toContain("under a lease declared never to go stale while its holder lives");
  });

  it("types a live holder whose age cannot be compared as LOCK_REFUSED, since nothing says that state ends", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(lockFileIn({ h }), JSON.stringify({ acquiredAtIso: "whenever", pid: process.pid }));

    const detailed = unwrapErr(
      acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" }),
    );

    expect(detailed.code).toBe("LOCK_REFUSED");
    expect(detailed.message).toContain("its own acquiredAtIso, whenever, is not a readable instant");
  });

  it("types a lock record that cannot be read as LOCK_REFUSED", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(lockFileIn({ h }), "{ not json");

    const detailed = unwrapErr(
      acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" }),
    );

    expect(detailed.code).toBe("LOCK_REFUSED");
    expect(detailed.message).toContain("could not be read to check its age");
  });

  it("types a stale holder its removal could not remove as LOCK_REFUSED, not as rounds of contention", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const lockDir = lockDirIn({ h });
    chmodSync(lockDir, 0o555); // the stale token inside can no longer be unlinked, so every round meets it again
    let result: DetailedOperationLockResult;
    try {
      result = acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:20:00Z" });
    } finally {
      chmodSync(lockDir, 0o755);
    }
    // Linux (CI) answers the rename onto the populated directory ENOTEMPTY, so the same stale holder is judged in
    // every round until they run out; darwin answers EACCES, an install fault, refused before any judgement. Both
    // are a refusal, never a deferral.
    expect(unwrapErr(result).code).toBe("LOCK_REFUSED");
  });

  it("types a lock that is in flux in every round as LOCK_REFUSED, since a state that never changes is not contention", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const token = lockFileIn({ h });
    rmSync(token);
    symlinkSync("missing-target", token); // a dangling token reads ENOENT, so every round sees the lock in flux

    const detailed = unwrapErr(
      acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" }),
    );

    expect(detailed.code).toBe("LOCK_REFUSED");
    expect(detailed.message).toContain("was never free at the instant this attempt tried it, across 8 rounds");
  });

  it("types a lock directory that cannot be staged as LOCK_REFUSED, rather than throwing past the caller", () => {
    const h = home();
    const lockDir = operationLockDir({ home: h });
    mkdirSync(join(lockDir, ".."), { recursive: true });
    writeFileSync(lockDir, "a file where the lock directory belongs");

    const detailed = unwrapErr(
      acquireOperationLockDetailed({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }),
    );

    expect(detailed.code).toBe("LOCK_REFUSED");
    expect(detailed.message).toContain("could not stage the lock at");
    expect(detailed.message).toContain("EEXIST");
  });

  it("still THROWS a staging fault from the string form, which its callers catch as a filesystem fault", () => {
    const h = home();
    const lockDir = operationLockDir({ home: h });
    mkdirSync(join(lockDir, ".."), { recursive: true });
    writeFileSync(lockDir, "a file where the lock directory belongs");

    expect(() => acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" })).toThrow(
      "EEXIST",
    );
  });
});
