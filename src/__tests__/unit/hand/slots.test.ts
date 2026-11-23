import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BEAT_WINDOW_MS, CLOSED_BEAT, STARTUP_WINDOW_MS } from "../../../hand/note/liveness.js";
import {
  NEVER_LAUNCHED,
  readReservations,
  reserveSlot,
  SLOT_QUIET_MS,
  sweepReservations,
} from "../../../hand/note/slots.js";

const NOW = Date.parse("2026-10-27T03:00:00.000Z");

/** A pid past darwin's ceiling of 99998, so never in the process table. */
const DEAD_PID = 9_999_999;

/** The level every ordinary hand step floats at. */
const ORDINARY = "ordinary";

let liveDir = "";

beforeEach(() => {
  liveDir = mkdtempSync(join(tmpdir(), "slots-"));
});

afterEach(() => {
  rmSync(liveDir, { force: true, recursive: true });
});

/**
 * Write one file in the live directory stamped at an exact instant.
 *
 * @param name the file name
 * @param text its contents
 * @param atMs the modification time to stamp
 */
function stamp({ name, text, atMs }: { name: string; text: string; atMs: number }): void {
  const path = join(liveDir, name);
  writeFileSync(path, text);
  utimesSync(path, new Date(atMs), new Date(atMs));
}

/** A note of step `id`, raised as `token` into `slot` of the `level` cascade, beating `beatAgeMs` ago. */
function beating({
  id,
  token,
  slot,
  beatAgeMs,
  level = ORDINARY,
}: {
  id: string;
  token: string;
  slot: number;
  beatAgeMs: number;
  level?: string;
}): void {
  stamp({ atMs: NOW - 120_000, name: `${token}.slot`, text: `${id} ${String(slot)} ${level}\n` });
  stamp({ atMs: NOW - beatAgeMs, name: `${id}.${token}.beat`, text: "6a7370b949f103d8\n" });
}

describe("reserveSlot — each raise takes its own place in the cascade", () => {
  it("takes slot 0 on an empty screen and records it with its level", () => {
    expect(reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta" })).toBe(0);
    expect(readFileSync(join(liveDir, "ta.slot"), "utf8")).toBe("a 0 ordinary\n");
  });

  it("gives two raises a moment apart two different slots — the monitor pass posting two cards", () => {
    const first = reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta" });
    utimesSync(join(liveDir, "ta.slot"), new Date(NOW - 1_000), new Date(NOW - 1_000));
    const second = reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" });
    expect([first, second]).toEqual([0, 1]);
  });

  it("holds a reservation stamped after the instant a concurrent raise judges at", () => {
    stamp({ atMs: NOW + 5, name: "ta.slot", text: "a 0 ordinary\n" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("holds a note whose beat is stamped after the instant a concurrent raise judges at", () => {
    stamp({ atMs: NOW - 120_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW + 5, name: "a.ta.beat", text: "6a7370b949f103d8\n" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("stacks past notes still beating, three up at once", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    beating({ beatAgeMs: 1_000, id: "b", slot: 1, token: "tb" });
    expect(reserveSlot({ id: "c", level: ORDINARY, liveDir, nowMs: NOW, token: "tc" })).toBe(2);
  });

  it("reuses the slot of a note the owner closed at the top of the stack", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    stamp({ atMs: NOW - 120_000, name: "tb.slot", text: "b 1 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "b.tb.beat", text: `${CLOSED_BEAT}\n` });
    expect(reserveSlot({ id: "c", level: ORDINARY, liveDir, nowMs: NOW, token: "tc" })).toBe(1);
  });

  it("never fills a gap under a live note, whose title the new note in front would cover", () => {
    stamp({ atMs: NOW - 120_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "a.ta.beat", text: `${CLOSED_BEAT}\n` });
    beating({ beatAgeMs: 1_000, id: "b", slot: 1, token: "tb" });
    expect(reserveSlot({ id: "c", level: ORDINARY, liveDir, nowMs: NOW, token: "tc" })).toBe(2);
  });

  it("reuses the slot of a note whose beat went quiet past the slot's window", () => {
    beating({ beatAgeMs: SLOT_QUIET_MS + 1, id: "a", slot: 0, token: "ta" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(0);
  });

  it("keeps the slot of a note whose beat a held button stalled past the liveness window", () => {
    beating({ beatAgeMs: BEAT_WINDOW_MS + 1, id: "a", slot: 0, token: "ta" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("keeps the slot of a live panel however long its beat has been quiet", () => {
    beating({ beatAgeMs: 6 * 3_600_000, id: "a", slot: 0, token: "ta" });
    stamp({ atMs: NOW - 6 * 3_600_000, name: "a.ta.beat.pid", text: String(process.pid) });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("frees the slot of a panel whose process is gone, its beat still fresh, and sweeps its pid file", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    stamp({ atMs: NOW - 1_000, name: "a.ta.beat.pid", text: String(DEAD_PID) });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(0);
    sweepReservations({ liveDir, nowMs: NOW });
    expect([existsSync(join(liveDir, "ta.slot")), existsSync(join(liveDir, "a.ta.beat.pid"))]).toEqual([false, false]);
  });

  it("keeps the slot of a panel that opened though its launcher reported failure", () => {
    stamp({ atMs: NOW - 1_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "ta.failed", text: "launch timed out\n" });
    stamp({ atMs: NOW - 500, name: "a.ta.beat.pid", text: String(process.pid) });
    stamp({ atMs: NOW - 500, name: "a.ta.beat", text: "6a7370b949f103d8\n" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("frees the slot of a note that closed, its panel still exiting", () => {
    stamp({ atMs: NOW - 120_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "a.ta.beat", text: `${CLOSED_BEAT}\n` });
    stamp({ atMs: NOW - 120_000, name: "a.ta.beat.pid", text: String(process.pid) });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(0);
  });

  it("keeps the slot of a raise that failed with no pid yet, its panel perhaps still starting", () => {
    stamp({ atMs: NOW - 1_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "ta.failed", text: "launch timed out\n" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(1);
  });

  it("reuses the slot of a raise that failed before it ever launched", () => {
    stamp({ atMs: NOW - 1_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "ta.failed", text: `${NEVER_LAUNCHED}\n` });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(0);
  });

  it("reuses the slot of a raise whose launch failed once the startup window has passed with no pid", () => {
    stamp({ atMs: NOW - STARTUP_WINDOW_MS - 1, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - STARTUP_WINDOW_MS - 1, name: "ta.failed", text: "launch failed\n" });
    expect(reserveSlot({ id: "b", level: ORDINARY, liveDir, nowMs: NOW, token: "tb" })).toBe(0);
  });

  it("holds a reservation with no beat yet only inside the startup window", () => {
    stamp({ atMs: NOW - STARTUP_WINDOW_MS, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - STARTUP_WINDOW_MS - 1, name: "tb.slot", text: "b 1 ordinary\n" });
    expect(reserveSlot({ id: "c", level: ORDINARY, liveDir, nowMs: NOW, token: "tc" })).toBe(1);
  });

  it("puts a step's replacement note in that step's own slot while it is the top of the stack", () => {
    beating({ beatAgeMs: 1_000, id: "b", slot: 0, token: "tb" });
    beating({ beatAgeMs: 1_000, id: "a", slot: 1, token: "ta" });
    expect(reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta2" })).toBe(1);
  });

  it("moves a step's replacement note to the top when a live note sits past its own slot", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    beating({ beatAgeMs: 1_000, id: "b", slot: 1, token: "tb" });
    expect(reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta2" })).toBe(2);
  });

  it("counts a meeting-prep note's slots in its own cascade, apart from the ordinary one", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    beating({ beatAgeMs: 1_000, id: "b", slot: 1, token: "tb" });
    expect(reserveSlot({ id: "m", level: "meeting-prep", liveDir, nowMs: NOW, token: "tm" })).toBe(0);
    expect(reserveSlot({ id: "c", level: ORDINARY, liveDir, nowMs: NOW, token: "tc" })).toBe(2);
    expect(readFileSync(join(liveDir, "tm.slot"), "utf8")).toBe("m 0 meeting-prep\n");
  });

  it("moves off a slot another step took while this raise was frozen between its pick and its write", () => {
    let frozen = true;
    const slot = reserveSlot({
      betweenPickAndWrite: () => {
        if (frozen) {
          frozen = false;
          // The takeover: another raise found this lock stale, took it, and reserved the same slot first.
          writeFileSync(join(liveDir, "slot.lock", "owner"), "tb");
          stamp({ atMs: NOW - 1_000, name: "tb.slot", text: "b 0 ordinary\n" });
        }
      },
      id: "a",
      level: ORDINARY,
      liveDir,
      nowMs: NOW,
      token: "ta",
    });
    expect([slot, readFileSync(join(liveDir, "ta.slot"), "utf8")]).toEqual([1, "a 1 ordinary\n"]);
    expect(readFileSync(join(liveDir, "slot.lock", "owner"), "utf8")).toBe("tb");
  });

  it("keeps its step's own slot when the note it replaces holds it", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    expect(
      reserveSlot({
        betweenPickAndWrite: () => undefined,
        id: "a",
        level: ORDINARY,
        liveDir,
        nowMs: NOW,
        token: "ta2",
      }),
    ).toBe(0);
  });

  it("releases its own lock once the slot is written", () => {
    reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta" });
    expect(existsSync(join(liveDir, "slot.lock"))).toBe(false);
  });

  it("takes over a lock a dead raise left behind", () => {
    const lock = join(liveDir, "slot.lock");
    mkdirSync(lock);
    utimesSync(lock, new Date(NOW - 60_000), new Date(NOW - 60_000));
    expect(reserveSlot({ id: "a", level: ORDINARY, liveDir, nowMs: NOW, token: "ta" })).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });
});

describe("sweepReservations — a reservation leaves once its note has", () => {
  it("removes the reservations that hold nothing and keeps the live ones", () => {
    beating({ beatAgeMs: 1_000, id: "a", slot: 0, token: "ta" });
    beating({ beatAgeMs: SLOT_QUIET_MS + 1, id: "b", slot: 1, token: "tb" });
    stamp({ atMs: NOW - 1_000, name: "tc.slot", text: "not a reservation\n" });
    stamp({ atMs: NOW - 1_000, name: "td.slot", text: "d 2 sideways\n" });
    sweepReservations({ liveDir, nowMs: NOW });
    expect(
      readReservations({ liveDir, nowMs: NOW }).map((entry) => [entry.reservation!.id, entry.reservation!.slot]),
    ).toEqual([["a", 0]]);
  });

  it("never sweeps a note by its own age — one up for hours still beats", () => {
    stamp({ atMs: NOW - 6 * 3_600_000, name: "ta.slot", text: "a 0 ordinary\n" });
    stamp({ atMs: NOW - 1_000, name: "a.ta.beat", text: "6a7370b949f103d8\n" });
    sweepReservations({ liveDir, nowMs: NOW });
    expect(existsSync(join(liveDir, "ta.slot"))).toBe(true);
  });
});
