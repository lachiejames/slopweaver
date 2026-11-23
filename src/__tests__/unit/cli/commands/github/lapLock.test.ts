import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireLapLock, readStandingLapLock, setAsideStale } from "../../../../../cli/commands/github/lapLock.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A pid no process on a test machine holds: above every platform's default pid ceiling. */
const DEAD_PID = 2 ** 30;
const LOCK = {
  phase: "running" as const,
  pid: process.pid,
  startedIso: "2026-11-10T03:00:00.000Z",
  subject: "o/r#7@abc",
};
const LATER = "2026-11-10T03:02:00.000Z";

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-lock-"));
  homes.push(home);
  return home;
}

describe("acquireLapLock", () => {
  it("holds the machine against a second lap while its own process lives, and frees it on disposal", async () => {
    const home = freshHome();
    const held = unwrap(acquireLapLock({ home, lock: LOCK }));
    const refused = unwrapErr(acquireLapLock({ home, lock: { ...LOCK, subject: "o/r#8@def" } }));
    expect(refused.code).toBe("LOCK_HELD");
    expect(refused.message).toContain(`another lap holds this machine: o/r#7@abc, pid ${String(process.pid)}`);
    await held.dispose();
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
  });

  it("refuses a second lap while the first is still in its preflight, naming that phase", async () => {
    const home = freshHome();
    const held = unwrap(acquireLapLock({ home, lock: { ...LOCK, phase: "preflight", subject: "o/r#7" } }));
    const refused = unwrapErr(acquireLapLock({ home, lock: { ...LOCK, subject: "o/r#8" } }));
    await held.dispose();
    expect(refused.message).toBe(
      `another lap holds this machine: o/r#7, pid ${String(process.pid)}, since 2026-11-10T03:00:00.000Z, ` +
        "still in its preflight, before its lanes. One lap at a time, because two would each starve the other into " +
        "timeouts; run again once it finishes",
    );
  });

  it("reads a lock an older lap wrote with no phase as running, and still refuses on it", () => {
    const home = freshHome();
    mkdirSync(join(home, "laps"));
    const { phase: _dropped, ...legacy } = LOCK;
    writeFileSync(join(home, "laps", "lock.json"), JSON.stringify({ ...legacy, nonce: "old" }));
    expect(readStandingLapLock({ home })!.phase).toBe("running");
    expect(unwrapErr(acquireLapLock({ home, lock: LOCK })).message).toContain(", running its lanes or landing.");
  });

  it("advances its own lock to running under the full subject, keeping its nonce and pid, staging nothing behind", async () => {
    const home = freshHome();
    const held = unwrap(acquireLapLock({ home, lock: { ...LOCK, phase: "preflight", subject: "o/r#7" } }));
    const path = join(home, "laps", "lock.json");
    const nonce = JSON.parse(readFileSync(path, "utf8")).nonce;
    unwrap(held.value.advance({ startedIso: LATER, subject: "o/r#7@abc" }));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      nonce,
      phase: "running",
      pid: process.pid,
      startedIso: LATER,
      subject: "o/r#7@abc",
    });
    expect(readdirSync(join(home, "laps"))).toEqual(["lock.json"]);
    await held.dispose();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses to advance a lock another lap has since taken, leaving theirs standing", () => {
    const home = freshHome();
    const held = unwrap(acquireLapLock({ home, lock: { ...LOCK, phase: "preflight", subject: "o/r#7" } }));
    const theirs = JSON.stringify({ ...LOCK, nonce: "theirs" });
    writeFileSync(join(home, "laps", "lock.json"), theirs);
    expect(unwrapErr(held.value.advance({ startedIso: LATER, subject: "o/r#7@abc" })).code).toBe("LOCK_UNAVAILABLE");
    expect(readFileSync(join(home, "laps", "lock.json"), "utf8")).toBe(theirs);
    expect(readdirSync(join(home, "laps"))).toEqual(["lock.json"]);
  });

  it("takes over a lock whose process is gone", () => {
    const home = freshHome();
    mkdirSync(join(home, "laps"));
    writeFileSync(join(home, "laps", "lock.json"), JSON.stringify({ ...LOCK, nonce: "old", pid: DEAD_PID }));
    unwrap(acquireLapLock({ home, lock: LOCK }));
    expect(JSON.parse(readFileSync(join(home, "laps", "lock.json"), "utf8")).nonce).not.toBe("old");
  });

  it("leaves only the lock itself behind, never the file it staged the body in, whether it took the lock or not", () => {
    const home = freshHome();
    unwrap(acquireLapLock({ home, lock: LOCK }));
    expect(JSON.parse(readFileSync(join(home, "laps", "lock.json"), "utf8")).subject).toBe("o/r#7@abc");
    expect(unwrapErr(acquireLapLock({ home, lock: { ...LOCK, subject: "o/r#8@def" } })).code).toBe("LOCK_HELD");
    expect(readdirSync(join(home, "laps"))).toEqual(["lock.json"]);
  });

  it("never removes a lock another lap has since taken", async () => {
    const home = freshHome();
    const held = unwrap(acquireLapLock({ home, lock: LOCK }));
    const theirs = JSON.stringify({ ...LOCK, nonce: "theirs" });
    writeFileSync(join(home, "laps", "lock.json"), theirs);
    await held.dispose();
    expect(readFileSync(join(home, "laps", "lock.json"), "utf8")).toBe(theirs);
  });
});

describe("setAsideStale", () => {
  /** A home holding one lock file with `body`, and that file's path. */
  function lockWith({ body }: { body: string }): string {
    const home = freshHome();
    mkdirSync(join(home, "laps"));
    const path = join(home, "laps", "lock.json");
    writeFileSync(path, body);
    return path;
  }

  it("removes the lock it judged stale", () => {
    const path = lockWith({ body: JSON.stringify({ ...LOCK, nonce: "old", pid: DEAD_PID }) });
    expect(setAsideStale({ judged: "old", nonce: "mine", path })).toBe("set-aside");
    expect(readdirSync(join(path, ".."))).toEqual([]);
  });

  it("puts back a FRESH lock a faster contender created after the judgement, never removing it", () => {
    const fresh = JSON.stringify({ ...LOCK, nonce: "fresh" });
    const path = lockWith({ body: fresh });
    expect(setAsideStale({ judged: "old", nonce: "mine", path })).toBe("restored");
    expect(readFileSync(path, "utf8")).toBe(fresh);
    expect(readdirSync(join(path, ".."))).toEqual(["lock.json"]);
  });

  it("answers lost when another contender already moved it", () => {
    const path = lockWith({ body: JSON.stringify({ ...LOCK, nonce: "old", pid: DEAD_PID }) });
    rmSync(path);
    expect(setAsideStale({ judged: "old", nonce: "mine", path })).toBe("lost");
  });
});
