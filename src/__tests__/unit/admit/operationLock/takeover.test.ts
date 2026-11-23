/**
 * A takeover removes the holder it judged, by name, and never writes over it: one new token survives, a late
 * release removes nothing it no longer owns, and no staging directory is left behind.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { home, lockDirIn, lockFileIn, useTempDirs } from "./harness.js";

useTempDirs();

describe("a takeover removes the judged holder by name and never writes over it", () => {
  function deadPid(): number {
    return spawnSync("true", [], { stdio: "ignore" }).pid;
  }

  it("leaves exactly one token file, a NEW one, with the dead holder's gone", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    const staleFile = lockFileIn({ h });
    const held = JSON.parse(readFileSync(staleFile, "utf8")) as { acquiredAtIso: string; pid: number };
    writeFileSync(staleFile, JSON.stringify({ acquiredAtIso: held.acquiredAtIso, pid: deadPid() }));
    const staleIno = statSync(staleFile).ino;

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:05Z" });

    expect(second.isOk()).toBe(true);
    const winnerFile = lockFileIn({ h });
    expect(winnerFile).not.toBe(staleFile);
    expect(statSync(winnerFile).ino).not.toBe(staleIno);
    expect(readdirSync(lockDirIn({ h }))).toHaveLength(1);
    expect((JSON.parse(readFileSync(winnerFile, "utf8")) as { pid: number }).pid).toBe(process.pid);
  });

  it("an aged handle's late release leaves its same-process successor holding the lock", () => {
    const h = home();
    const first = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:00Z",
      staleAfterMs: 1000,
    });
    expect(first.isOk()).toBe(true);
    const second = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:02Z",
      staleAfterMs: 1000,
    });
    expect(second.isOk()).toBe(true);
    const successorFile = lockFileIn({ h });

    first._unsafeUnwrap().release();

    expect(readdirSync(lockDirIn({ h }))).toEqual([successorFile.slice(lockDirIn({ h }).length + 1)]);
    const third = acquireOperationLock({
      home: h,
      key: "owner/repo",
      nowIso: "2026-08-11T00:00:02.5Z",
      staleAfterMs: 1000,
    });
    expect(third.isOk()).toBe(false);
  });

  it("a second call of an old release callback after release-then-reacquire removes nothing", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    first._unsafeUnwrap().release();
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });
    expect(second.isOk()).toBe(true);

    first._unsafeUnwrap().release();

    expect(readdirSync(lockDirIn({ h }))).toHaveLength(1);
    const third = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:02Z" });
    expect(third.isOk()).toBe(false);
  });

  it("an empty lock directory left mid-takeover is simply replaced", () => {
    const h = home();
    const dir = join(h, "ledgers", "operation-locks");
    mkdirSync(dir, { recursive: true });
    // The same name the module would compute for this key: it is the only entry, so the test reads it back.
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    const lockDir = lockDirIn({ h });
    first._unsafeUnwrap().release();
    mkdirSync(lockDir);

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });

    expect(second.isOk()).toBe(true);
    expect(readdirSync(lockDir)).toHaveLength(1);
  });

  it("a lock directory holding two files is refused as unreadable rather than judged", () => {
    const h = home();
    expect(acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" }).isOk()).toBe(true);
    writeFileSync(join(lockDirIn({ h }), "second-token"), "{}");

    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });

    expect(second.isOk()).toBe(false);
    expect(second._unsafeUnwrapErr()).toContain("could not be read to check its age");
  });

  it("leaves its candidate alone once it has become the lock, so a reused name is never written into", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    expect(first.isOk()).toBe(true);
    // A directory standing where a candidate once did — the name mkdtemp freed when the rename moved it.
    const dir = join(h, "ledgers", "operation-locks");
    const reused = join(dir, "reused.candidate-aaaaaa");
    mkdirSync(reused);
    writeFileSync(join(reused, "someone-elses-token"), "{}");

    first._unsafeUnwrap().release();

    expect(readdirSync(reused)).toEqual(["someone-elses-token"]);
  });

  it("leaves no staging directory behind, whether it acquired or was refused", () => {
    const h = home();
    const first = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:00Z" });
    expect(first.isOk()).toBe(true);
    const second = acquireOperationLock({ home: h, key: "owner/repo", nowIso: "2026-08-11T00:00:01Z" });
    expect(second.isOk()).toBe(false);

    const entries = readdirSync(join(h, "ledgers", "operation-locks"));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.endsWith(".lock")).toBe(true);
  });
});
