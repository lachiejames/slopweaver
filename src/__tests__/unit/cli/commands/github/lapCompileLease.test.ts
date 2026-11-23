import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLockDetailed } from "../../../../../admit/operationLock.js";
import { OperationLockAcquireErrors } from "../../../../../admit/operationLockHeld.js";
import {
  acquireLapMachine,
  COMPILE_LEASE_KEY,
  COMPILE_LEASE_WAIT_MS,
  compileLeasePath,
  waitForCompileLease,
} from "../../../../../cli/commands/github/lapCompileLease.js";
import { acquireLapLock } from "../../../../../cli/commands/github/lapLock.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { userRuntimeLockDir } from "../../../../../stateRuntime.js";

const LOCK = {
  phase: "preflight" as const,
  pid: process.pid,
  startedIso: "2026-11-20T03:00:00.000Z",
  subject: "o/r#7@abc",
};

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-lease-"));
  homes.push(home);
  return home;
}

/** A clock that advances by `stepMs` each time it is read, and the lines and pauses a wait produced. */
function harness({ stepMs }: { stepMs: number }): {
  now: () => Date;
  out: (args: { line: string }) => void;
  sleep: (args: { ms: number }) => void;
  lines: string[];
  sleeps: number[];
} {
  let at = Date.parse("2026-11-20T03:00:00.000Z");
  const lines: string[] = [];
  const sleeps: number[] = [];
  return {
    lines,
    now: () => {
      const read = new Date(at);
      at += stepMs;
      return read;
    },
    out: ({ line }) => {
      lines.push(line);
    },
    sleep: ({ ms }) => {
      sleeps.push(ms);
    },
    sleeps,
  };
}

const CONTENDED = err(
  OperationLockAcquireErrors.contended({ message: "held by pid 4242 (since 2026-11-20T02:59:00.000Z)" }),
);

describe("the compile lease's name", () => {
  it("is the one scripts/tsc-owner.sh derives, so the owner and the lap contend for ONE lease", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "tsc-owner.sh"), "utf8");
    expect(/^LEASE_KEY=(\S+)$/mu.exec(script)![1]).toBe(COMPILE_LEASE_KEY);
    // The script's derivation, spelled exactly: the first 32 hex of the key's SHA-256, the operation lock's own name.
    expect(/^LEASE_DIGEST='(.+)'$/mu.exec(script)![1]).toBe(
      'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1], "utf8").digest("hex").slice(0, 32))',
    );
    const derived = createHash("sha256").update(COMPILE_LEASE_KEY, "utf8").digest("hex").slice(0, 32);
    expect(basename(compileLeasePath({ directory: "/anywhere" }))).toBe(`${derived}.lock`);
  });

  it("is keyed by the one key the lap takes it under", () => {
    expect(COMPILE_LEASE_KEY).toBe("typescript-compile");
    expect(compileLeasePath({ directory: "/d" })).toMatch(/^\/d\/[0-9a-f]{32}\.lock$/u);
  });
});

describe("waitForCompileLease", () => {
  it("takes the lease on the first try without a word", async () => {
    const h = harness({ stepMs: 10 });
    let released = 0;
    const lease = waitForCompileLease({
      attempt: () =>
        ok({
          release: () => {
            released += 1;
          },
          stillHeld: () => true,
          stoleFromPid: undefined,
        }),
      now: h.now,
      out: h.out,
      sleep: h.sleep,
      waitMs: 5000,
    });
    await unwrap(lease).dispose();
    expect(released).toBe(1);
    expect(h.lines).toEqual([]);
    expect(h.sleeps).toEqual([]);
  });

  it("waits out a holder, saying so ONCE, then takes the lease", () => {
    const h = harness({ stepMs: 10 });
    const answers = [
      CONTENDED,
      CONTENDED,
      CONTENDED,
      ok({ release: () => undefined, stillHeld: () => true, stoleFromPid: undefined }),
    ];
    let tries = 0;
    const lease = waitForCompileLease({
      attempt: () => {
        tries += 1;
        return answers[tries - 1]!;
      },
      now: h.now,
      out: h.out,
      sleep: h.sleep,
      waitMs: 5000,
    });
    expect(lease.isOk()).toBe(true);
    expect(h.sleeps).toEqual([1000, 1000, 1000]);
    expect(h.lines).toEqual([
      "github lap: waiting for the machine's TypeScript compile lease, held by pid 4242 (since 2026-11-20T02:59:00.000Z) — one compile at a time; giving up after 5s",
    ]);
  });

  it("refuses COMPILE_LEASE_HELD once the wait runs out, naming the holder", () => {
    const h = harness({ stepMs: 1000 });
    const lease = waitForCompileLease({
      attempt: () => CONTENDED,
      now: h.now,
      out: h.out,
      sleep: h.sleep,
      waitMs: 3000,
    });
    const refused = unwrapErr(lease);
    expect(refused.code).toBe("COMPILE_LEASE_HELD");
    expect(refused.message).toContain("is still held by pid 4242 (since 2026-11-20T02:59:00.000Z) after 4s of waiting");
    expect(h.lines.length).toBe(1);
  });

  it("refuses COMPILE_LEASE_UNAVAILABLE at once on a lease it cannot judge, never waiting on it", () => {
    const h = harness({ stepMs: 10 });
    const lease = waitForCompileLease({
      attempt: () => err(OperationLockAcquireErrors.refused({ message: "lock directory holds two records" })),
      now: h.now,
      out: h.out,
      sleep: h.sleep,
      waitMs: 5000,
    });
    const refused = unwrapErr(lease);
    expect(refused.code).toBe("COMPILE_LEASE_UNAVAILABLE");
    expect(refused.message).toBe(
      "could not take the machine's TypeScript compile lease: lock directory holds two records",
    );
    expect(h.sleeps).toEqual([]);
  });

  it("waits the owner's own lock budget: one whole root compile and its reap, with room over", () => {
    expect(COMPILE_LEASE_WAIT_MS).toBe(1_200_000);
  });
});

describe("acquireLapMachine", () => {
  it("holds the lap lock AND the compile lease in this user's lock directory, and frees both on disposal", async () => {
    const home = freshHome();
    const lease = compileLeasePath({ directory: unwrap(userRuntimeLockDir()) });
    const held = unwrap(acquireLapMachine({ home, lock: LOCK, out: () => undefined }));
    expect(readdirSync(lease).length).toBe(1);
    const record = JSON.parse(readFileSync(join(lease, readdirSync(lease)[0]!), "utf8")) as { pid: number };
    expect(record.pid).toBe(process.pid);
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(true);
    await held.dispose();
    expect(existsSync(lease)).toBe(false);
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
  });

  it("releases the lap lock when the wait throws, so a failing output sink strands nothing", () => {
    const home = freshHome();
    const seat = unwrap(
      acquireOperationLockDetailed({
        directory: unwrap(userRuntimeLockDir()),
        home,
        key: COMPILE_LEASE_KEY,
        nowIso: "2026-11-20T03:00:00.000Z",
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    );
    expect(() =>
      acquireLapMachine({
        home,
        lock: LOCK,
        out: () => {
          throw new Error("sink failed");
        },
      }),
    ).toThrow("sink failed");
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
    seat.release();
  });

  it("refuses a second lap at its lap lock, before it ever touches the compile lease", async () => {
    const home = freshHome();
    const lease = compileLeasePath({ directory: unwrap(userRuntimeLockDir()) });
    const first = unwrap(acquireLapLock({ home, lock: LOCK }));
    const refused = unwrapErr(
      acquireLapMachine({ home, lock: { ...LOCK, subject: "o/r#8@def" }, out: () => undefined }),
    );
    expect(refused.code).toBe("LOCK_HELD");
    expect(existsSync(lease)).toBe(false);
    await first.dispose();
  });
});
