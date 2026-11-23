/*
 * The landing ledger's write lock: one landing decides off the ledger at a time, so a second `talk transcript` run
 * reads the first one's row rather than registering a second dispatch row for the same utterance.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { appendCardLanding, holdCardLandingLock, readCardLandings } from "../../../talk/cardLandingStore.js";
import type { StartOf } from "../../../talk/relayLease.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-landing-lock-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The running processes, each pid started at the stamp `t<pid>`; every other pid is not running. */
const alive =
  (...pids: number[]): StartOf =>
  (pid) =>
    pids.includes(pid) ? { running: true, start: `t${String(pid)}` } : { running: false, start: undefined };

const lockPath = (): string => join(home, "talk", "card-landings.jsonl.lock");

describe("holdCardLandingLock", () => {
  it("holds the ledger's lock until released", () => {
    const release = unwrap(holdCardLandingLock({ home, pid: 101, startOf: alive(101), waitMs: 10_000 }));
    expect(readFileSync(lockPath(), "utf8")).toBe("101 t101\n");
    release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("refuses while another live landing holds it, naming the lock, and leaves that lock alone", () => {
    unwrap(holdCardLandingLock({ home, pid: 4242, startOf: alive(4242), waitMs: 10_000 }));
    const refused = unwrapErr(holdCardLandingLock({ home, pid: 101, startOf: alive(101, 4242), waitMs: 30 }));
    expect(refused.code).toBe("LEDGER_IO");
    expect(refused.message).toContain("card-landings.jsonl.lock");
    expect(readFileSync(lockPath(), "utf8")).toBe("4242 t4242\n");
  });

  it("takes over a lock whose holder died mid-landing", () => {
    unwrap(holdCardLandingLock({ home, pid: 4242, startOf: alive(4242), waitMs: 10_000 }));
    const release = unwrap(holdCardLandingLock({ home, pid: 101, startOf: alive(101), waitMs: 10_000 }));
    expect(readFileSync(lockPath(), "utf8")).toBe("101 t101\n");
    release();
  });
});

describe("appendCardLanding", () => {
  const LANDED: CardLandedRow = {
    anchor: "call:a0000041-0000-4000-8000-000000000044#s-1",
    atIso: "2026-09-26T21:05:00.000Z",
    cardKey: "ask:ship-it",
    decidedIso: "2026-09-26T21:04:00.000Z",
    kind: "landed",
    source: "transcript",
    words: "ship it",
    workSlug: "ship-it",
  };

  it("starts its row on a line of its own after a torn append, so the retry reads back", () => {
    const path = unwrap(appendCardLanding({ home, row: LANDED }));
    appendFileSync(path, '{"kind":"landed","atIso":"2026-09-26T21:0');
    unwrap(appendCardLanding({ home, row: { ...LANDED, atIso: "2026-09-26T21:06:00.000Z" } }));
    const read = unwrap(readCardLandings({ home }));
    expect([read.rows.map((row) => row.atIso), read.unreadable]).toEqual([
      ["2026-09-26T21:05:00.000Z", "2026-09-26T21:06:00.000Z"],
      [2],
    ]);
  });
});
