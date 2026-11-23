/*
 * A call append's published intent, and the drained hold a binding reader's fence takes: the lock
 * has no queue, so an append already waiting for it must run before the fence reads the owner's words, never just
 * after the approval was recorded.
 */
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { holdCallLock } from "../../../talk/callLock.js";
import {
  announceCallWrite,
  awaitCallsDrained,
  holdAnnouncedLock,
  holdDrainedCallLock,
  pendingCallWrites,
} from "../../../talk/callWriteIntent.js";
import type { StartOf } from "../../../talk/relayLease.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-call-intent-"));
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

/** A clock one millisecond later on every read. */
function tickingClock(): () => number {
  let ms = 0;
  return () => {
    ms += 1;
    return ms;
  };
}

describe("pendingCallWrites", () => {
  it("counts a running holder's intent and one whose line does not read yet, never a gone holder's or another call's", () => {
    announceCallWrite({ path, pid: 202, start: "t202" });
    announceCallWrite({ path, pid: 303, start: "t303" });
    announceCallWrite({ path: join(dir, "other.jsonl"), pid: 202, start: "t202" });
    const startOf = alive(202);
    const before = pendingCallWrites({ path, startOf });
    writeFileSync(`${path}.intent.404.1`, "");
    expect([before, pendingCallWrites({ path, startOf })]).toEqual([1, 2]);
  });

  it("counts nothing beside a call whose directory is not there", () => {
    expect(pendingCallWrites({ path: join(dir, "absent", "call.jsonl"), startOf: alive(202) })).toBe(0);
  });
});

describe("holdAnnouncedLock", () => {
  it("is waiting while it holds the lock, and withdraws its intent before the lock goes", () => {
    const release = holdAnnouncedLock({ path, pid: 202, startOf: alive(202), waitMs: 0 });
    const held = [pendingCallWrites({ path, startOf: alive(202) }), existsSync(`${path}.lock`)];
    release();
    expect([held, [pendingCallWrites({ path, startOf: alive(202) }), existsSync(`${path}.lock`)]]).toEqual([
      [1, true],
      [0, false],
    ]);
  });
});

describe("holdDrainedCallLock", () => {
  it("lets an append already waiting take the lock and land before it holds the call", () => {
    const startOf = alive(101, 202);
    const withdraw = announceCallWrite({ path, pid: 202, start: "t202" });
    let pauses = 0;
    // The waiting append, run while the fence has let the lock go: it takes the lock, lands its line, withdraws.
    const appendWaiting = (): void => {
      pauses += 1;
      const release = holdCallLock({ path, pid: 202, startOf, waitMs: 0 });
      appendFileSync(path, "the batch already sent\n");
      withdraw();
      release();
    };
    const release = holdDrainedCallLock({ path, pause: appendWaiting, pid: 101, startOf, waitMs: 10_000 });
    const seen = readFileSync(path, "utf8");
    release();
    expect([seen, pauses, readdirSync(dir)]).toEqual(["the batch already sent\n", 1, ["call.jsonl"]]);
  });

  it("refuses once an append is still waiting past the wait, leaving the lock free", () => {
    announceCallWrite({ path, pid: 202, start: "t202" });
    expect(() =>
      holdDrainedCallLock({
        now: tickingClock(),
        path,
        pause: () => undefined,
        pid: 101,
        startOf: alive(101, 202),
        waitMs: 5,
      }),
    ).toThrow(`1 append(s) of ${path} were still waiting after 5 ms`);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("holds at once when the only intent beside the call is a gone holder's", () => {
    announceCallWrite({ path, pid: 202, start: "t202" });
    let pauses = 0;
    const release = holdDrainedCallLock({
      path,
      pause: () => {
        pauses += 1;
      },
      pid: 101,
      startOf: alive(101),
      waitMs: 0,
    });
    const held = existsSync(`${path}.lock`);
    release();
    expect([held, pauses]).toEqual([true, 0]);
  });
});

describe("awaitCallsDrained", () => {
  it("waits for an append waiting on another call, ignoring a gone holder's and a name that is no call's", () => {
    const withdraw = announceCallWrite({ path: join(dir, "other.jsonl"), pid: 202, start: "t202" });
    announceCallWrite({ path, pid: 303, start: "t303" });
    writeFileSync(join(dir, "notes.txt.intent.202.9"), "202 t202\n");
    let pauses = 0;
    awaitCallsDrained({
      dir,
      pause: () => {
        pauses += 1;
        withdraw();
      },
      startOf: alive(202),
      waitMs: 10_000,
    });
    expect(pauses).toBe(1);
  });

  it("refuses once an append on any call is still waiting past the wait", () => {
    announceCallWrite({ path: join(dir, "other.jsonl"), pid: 202, start: "t202" });
    expect(() =>
      awaitCallsDrained({ dir, now: tickingClock(), pause: () => undefined, startOf: alive(202), waitMs: 5 }),
    ).toThrow(`1 call append(s) in ${dir} were still waiting after 5 ms`);
  });
});
