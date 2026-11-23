/*
 * A call file's append lock on its own: it names its holder, a live holder keeps it until the wait runs out, a dead
 * one is taken over, and release removes only a lock that still names this writer. The append it guards is
 * `callStore.test.ts`.
 */
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unstampedLeaseRefusal } from "../../../admit/lockHolder.js";
import { DEFAULT_STALE_AFTER_MS } from "../../../admit/operationLockHeld.js";
import { CALL_LOCK_WAIT_MS, holdCallLock } from "../../../talk/callLock.js";
import type { StartOf } from "../../../talk/relayLease.js";

/** When a fixture's lock file was written, pinned by `utimesSync`, in seconds and in milliseconds. */
const PLACED_S = 1_700_000_000;
const PLACED_MS = PLACED_S * 1000;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-call-lock-"));
  path = join(dir, "call.jsonl");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** The running processes, each pid started at the stamp `t<pid>`; every other pid is not running. */
const alive =
  (...pids: number[]): StartOf =>
  (pid) =>
    pids.includes(pid) ? { running: true, start: `t${String(pid)}` } : { running: false, start: undefined };

/** A clock one millisecond later on every read: the loaded runner whose tick between two reads refused a free lock. */
function tickingClock({ from = 0 }: { from?: number } = {}): () => number {
  let ms = from;
  return () => {
    ms += 1;
    return ms;
  };
}

describe("holdCallLock", () => {
  // CI run 40310687910, unit-5: `waitMs: 0` on a free lock threw when the clock ticked before the first try.
  it("tries a free lock once even when the clock has passed a zero wait", () => {
    const release = holdCallLock({ now: tickingClock(), path, pid: 101, startOf: alive(101), waitMs: 0 });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("unlinks a hard link or symlink planted at its staging name, never writing through it to the file it names", () => {
    const other = join(dir, "other.jsonl");
    writeFileSync(other, "another call's journal\n");
    linkSync(other, `${path}.lock.101.tmp`);
    holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: 0 })();
    symlinkSync(other, `${path}.lock.101.tmp`);
    holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: 0 })();
    expect([readFileSync(other, "utf8"), existsSync(`${path}.lock.101.tmp`)]).toEqual([
      "another call's journal\n",
      false,
    ]);
  });

  it("takes over a dead holder's lock on a zero wait", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    const release = holdCallLock({ now: tickingClock(), path, pid: 101, startOf: alive(101), waitMs: 0 });
    expect([readFileSync(`${path}.lock`, "utf8"), existsSync(`${path}.lock.takeover`)]).toEqual(["101 t101\n", false]);
    release();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  // The first try lands inside the wait; the clock passes it during the takeover, and the freed lock is still placed.
  it("places the lock it freed even when the takeover ran past the deadline", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    const release = holdCallLock({ now: tickingClock(), path, pid: 101, startOf: alive(101), waitMs: 1 });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
  });

  it("refuses a live holder on a zero wait and leaves its lock alone", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    expect(() => holdCallLock({ now: tickingClock(), path, pid: 101, startOf: alive(101, 4242), waitMs: 0 })).toThrow(
      "a live writer has held",
    );
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("4242 t4242\n");
  });

  it("names its holder while held, and is gone once released", () => {
    const release = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: CALL_LOCK_WAIT_MS });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("refuses once a live holder has kept it past the wait, and leaves that holder's lock alone", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    expect(() => holdCallLock({ path, pid: 101, startOf: alive(101, 4242), waitMs: 30 })).toThrow(
      "a live writer has held",
    );
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("4242 t4242\n");
  });

  it("takes over a lock whose holder is no longer running", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    const release = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: CALL_LOCK_WAIT_MS });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
  });

  // Two writers found the same dead holder, and the second removed the lock the first had just placed.
  it("leaves a dead holder's lock to the writer already taking it over", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    writeFileSync(`${path}.lock.takeover`, "5151 t5151\n");
    expect(() => holdCallLock({ path, pid: 101, startOf: alive(101, 5151), waitMs: 30 })).toThrow(
      "a live writer has held",
    );
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("4242 t4242\n");
  });

  it("clears a takeover whose writer died too, then takes the lock over", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    writeFileSync(`${path}.lock.takeover`, "5151 t5151\n");
    const release = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: CALL_LOCK_WAIT_MS });
    expect([readFileSync(`${path}.lock`, "utf8"), existsSync(`${path}.lock.takeover`)]).toEqual(["101 t101\n", false]);
    release();
  });

  it("refuses a writer `ps` could not stamp, placing nothing, since a lock that never ages trusts its holder's identity", () => {
    const unstamped: StartOf = (pid) => ({ running: true, start: pid === 101 ? undefined : `t${String(pid)}` });
    expect(() => holdCallLock({ path, pid: 101, startOf: unstamped, waitMs: 0 })).toThrow(
      unstampedLeaseRefusal({ path: `${path}.lock`, staleAfterMs: Number.POSITIVE_INFINITY, start: undefined })!,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  // `-` is the record's own no-stamp mark, so a start reading `-` would have written `101 -`.
  // A newline does not survive the read, and a lone surrogate survives it but not the UTF-8 write.
  it("refuses a writer whose start would not read back as a stamp, placing nothing", () => {
    const refusal = unstampedLeaseRefusal({
      path: `${path}.lock`,
      staleAfterMs: Number.POSITIVE_INFINITY,
      start: undefined,
    })!;
    const starts = ["-", "", " t101 ", "t1\nt2", String.fromCharCode(0xd800)];
    const thrown = starts.map((start) => {
      try {
        holdCallLock({ path, pid: 101, startOf: () => ({ running: true, start }), waitMs: 0 });
        return "placed";
      } catch (error: unknown) {
        return String(error);
      }
    });
    expect([thrown, readdirSync(dir)]).toEqual([starts.map(() => `Error: ${refusal}`), []]);
  });

  it("leaves it with a dead holder's unstamped lock at once, at any age", () => {
    writeFileSync(`${path}.lock`, "4242 -\n");
    utimesSync(`${path}.lock`, PLACED_S, PLACED_S);
    const release = holdCallLock({
      now: tickingClock({ from: PLACED_MS }),
      path,
      pid: 101,
      startOf: alive(101),
      waitMs: 0,
    });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
  });

  // A pid-only record's pid may be another process's by now, so it is held only through the operation lock's window.
  it("holds a live pid's unstamped lock through the ordinary window, and takes it over past it", () => {
    writeFileSync(`${path}.lock`, "4242 -\n");
    utimesSync(`${path}.lock`, PLACED_S, PLACED_S);
    // The clock ticks a millisecond a read, so the deadline passes; a margin keeps the age clear of those few ticks.
    const attempt = ({ ageMs }: { ageMs: number }): (() => void) =>
      holdCallLock({
        now: tickingClock({ from: PLACED_MS + ageMs }),
        path,
        pid: 101,
        startOf: alive(101, 4242),
        waitMs: 0,
      });
    expect(() => attempt({ ageMs: 0 })).toThrow("a live writer has held");
    expect(() => attempt({ ageMs: DEFAULT_STALE_AFTER_MS - 100 })).toThrow("a live writer has held");
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("4242 -\n");
    const release = attempt({ ageMs: DEFAULT_STALE_AFTER_MS + 100 });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    release();
  });

  it("clears an unstamped takeover guard past the ordinary window, whose live pid would otherwise wedge it", () => {
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    writeFileSync(`${path}.lock.takeover`, "5151 -\n");
    utimesSync(`${path}.lock.takeover`, PLACED_S, PLACED_S);
    const release = holdCallLock({
      now: tickingClock({ from: PLACED_MS + DEFAULT_STALE_AFTER_MS + 100 }),
      path,
      pid: 101,
      startOf: alive(101, 5151),
      // One pass clears the guard, the next takes the lock over, so this writer waits past the first.
      waitMs: CALL_LOCK_WAIT_MS,
    });
    expect([readFileSync(`${path}.lock`, "utf8"), existsSync(`${path}.lock.takeover`)]).toEqual(["101 t101\n", false]);
    release();
  });

  // A guard or lock judged abandoned was replaced by a live writer's before the unlink, which removed it.
  it("keeps a guard or lock a live writer placed while the one it replaced was being judged", () => {
    /** Every pid but 101 and 6161 dead; on `pid`'s `onCall`th liveness read, `file` is replaced by 6161's own. */
    const swapping = ({ file, onCall, pid }: { file: string; onCall: number; pid: number }): StartOf => {
      let calls = 0;
      return (asked) => {
        if (asked === pid) {
          calls += 1;
        }
        if (asked === pid && calls === onCall) {
          rmSync(file);
          writeFileSync(file, "6161 t6161\n");
        }
        return alive(101, 6161)(asked);
      };
    };
    const guard = `${path}.lock.takeover`;
    writeFileSync(`${path}.lock`, "4242 t4242\n");
    writeFileSync(guard, "5151 t5151\n");
    const guardSwap = swapping({ file: guard, onCall: 1, pid: 5151 });
    expect(() => holdCallLock({ path, pid: 101, startOf: guardSwap, waitMs: 0 })).toThrow("a live writer has held");
    expect(readFileSync(guard, "utf8")).toBe("6161 t6161\n");
    rmSync(guard);
    // The lock is judged twice: once to start a takeover, once more under the guard, where the swap lands.
    const lockSwap = swapping({ file: `${path}.lock`, onCall: 2, pid: 4242 });
    expect(() => holdCallLock({ path, pid: 101, startOf: lockSwap, waitMs: 0 })).toThrow("a live writer has held");
    expect([readFileSync(`${path}.lock`, "utf8"), existsSync(guard)]).toEqual(["6161 t6161\n", false]);
  });

  it("leaves a lock another writer placed after this one's was taken over", () => {
    const release = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: CALL_LOCK_WAIT_MS });
    writeFileSync(`${path}.lock`, "202 t202\n");
    release();
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("202 t202\n");
  });

  // The second hold's lock carries the same line, so a release judged by its line alone removed it.
  it("leaves a lock the same writer re-placed after its first was removed out from under it", () => {
    const first = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: 0 });
    // A second name keeps the first lock's inode allocated, so the re-placed one cannot be handed the same number.
    linkSync(`${path}.lock`, join(dir, "first-lock-pin"));
    rmSync(`${path}.lock`);
    const second = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: 0 });
    first();
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
    second();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  // Read through the link, the lock carried its target's identity, so release unlinked the link.
  it("leaves a symlink placed at the lock path after this writer's lock, even one naming that very lock", () => {
    const release = holdCallLock({ path, pid: 101, startOf: alive(101), waitMs: 0 });
    const saved = join(dir, "saved-lock");
    linkSync(`${path}.lock`, saved);
    rmSync(`${path}.lock`);
    symlinkSync(saved, `${path}.lock`);
    release();
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("101 t101\n");
  });
});
