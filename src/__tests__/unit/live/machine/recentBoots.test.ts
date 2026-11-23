/**
 * Recent boots — the sessions that started too recently for the 1-minute load to see: which count,
 * where the window's edge falls, when they hold, and which holds are the machine's rather than theirs.
 */
import { describe, expect, it } from "vitest";

import type { ProcessElapsed } from "../../../../live/machine/fleetLoad.js";
import {
  BOOT_WINDOW_SECONDS,
  DEFAULT_RECENT_BOOTS_HOLD,
  holdBlocksWait,
  machineHoldStands,
  recentBoots,
  recentBootsClause,
  recentBootsHolding,
} from "../../../../live/machine/recentBoots.js";
import type { ClaudeSession } from "../../../../live/machine/sessionOwner.js";

/** One registered session. */
function session({ pid }: { pid: number }): ClaudeSession {
  return { cwd: `/wt/${String(pid)}`, pid, sessionId: `s-${String(pid)}` };
}

/**
 * Eight sessions, each `ps` row aged as given — six boots in one pass, spread across the window's edge:
 * six inside it, one exactly at it, one a day old. Six is the hold.
 */
const SESSIONS: readonly ClaudeSession[] = [100, 101, 102, 103, 104, 105, 106, 107].map((pid) => session({ pid }));
const ELAPSED: readonly ProcessElapsed[] = [
  { pid: 100, seconds: 12 },
  { pid: 101, seconds: 4 },
  { pid: 102, seconds: 179 },
  { pid: 103, seconds: 180 },
  { pid: 104, seconds: 86_400 },
  { pid: 105, seconds: 30 },
  { pid: 106, seconds: 60 },
  { pid: 107, seconds: 90 },
];

describe("recentBoots", () => {
  it("counts the sessions started inside the window, newest first, and not one exactly at its edge", () => {
    const reading = recentBoots({ elapsedRows: ELAPSED, sessions: SESSIONS });

    expect(reading.boots.map((boot) => boot.pid)).toStrictEqual([101, 100, 105, 106, 107, 102]);
    expect(reading.boots[0]).toStrictEqual({ cwd: "/wt/101", pid: 101, seconds: 4, sessionId: "s-101" });
    expect(reading.windowSeconds).toBe(BOOT_WINDOW_SECONDS);
    expect(reading.hold).toBe(DEFAULT_RECENT_BOOTS_HOLD);
  });

  it("holds at six boots by default", () => {
    expect(DEFAULT_RECENT_BOOTS_HOLD).toBe(6);
  });

  it("does not count a session whose pid ps did not list — no age is not a young age", () => {
    const reading = recentBoots({ elapsedRows: [], sessions: SESSIONS });

    expect(reading.boots).toStrictEqual([]);
  });

  it("does not count an elapsed row no session registered — a young process is not a boot", () => {
    const reading = recentBoots({ elapsedRows: [{ pid: 999, seconds: 1 }], sessions: SESSIONS });

    expect(reading.boots).toStrictEqual([]);
  });
});

describe("recentBootsHolding", () => {
  it("holds AT the threshold and not one below it", () => {
    const six = recentBoots({ elapsedRows: ELAPSED, sessions: SESSIONS });
    const five = recentBoots({ elapsedRows: ELAPSED.filter((row) => row.pid !== 102), sessions: SESSIONS });

    expect(six.boots.length).toBe(6);
    expect(five.boots.length).toBe(5);
    expect(recentBootsHolding({ reading: six })).toBe(true);
    expect(recentBootsHolding({ reading: five })).toBe(false);
  });
});

describe("recentBootsClause", () => {
  it("names the count, the window in minutes and the threshold", () => {
    const reading = recentBoots({ elapsedRows: ELAPSED, sessions: SESSIONS });

    expect(recentBootsClause({ reading })).toBe(
      "6 sessions booted in the last 3m, hold at 6 — the 1-min load cannot see them yet",
    );
  });

  it("says one session, and a window that is not whole minutes in seconds", () => {
    const reading = recentBoots({
      elapsedRows: [{ pid: 100, seconds: 5 }],
      hold: 1,
      sessions: SESSIONS,
      windowSeconds: 90,
    });

    expect(recentBootsClause({ reading })).toBe(
      "1 session booted in the last 90s, hold at 1 — the 1-min load cannot see them yet",
    );
  });
});

describe("machineHoldStands", () => {
  it("is false for a hold on boots alone, and for no hold", () => {
    expect(machineHoldStands({ hold: true, holdSubjects: ["boots"] })).toBe(false);
    expect(machineHoldStands({ hold: false, holdSubjects: [] })).toBe(false);
  });

  it("is true when anything besides boots holds", () => {
    expect(machineHoldStands({ hold: true, holdSubjects: ["cpu", "boots"] })).toBe(true);
    expect(machineHoldStands({ hold: true, holdSubjects: ["memory"] })).toBe(true);
  });

  it("reads a hold naming no subject as the machine, never as clean", () => {
    expect(machineHoldStands({ hold: true, holdSubjects: [] })).toBe(true);
  });

  it("is false for a hold on the disk floor alone, or on disk and boots together", () => {
    expect(machineHoldStands({ hold: true, holdSubjects: ["disk"] })).toBe(false);
    expect(machineHoldStands({ hold: true, holdSubjects: ["boots", "disk"] })).toBe(false);
  });

  it("is true when cpu holds beside the disk floor", () => {
    expect(machineHoldStands({ hold: true, holdSubjects: ["cpu", "disk"] })).toBe(true);
  });
});

describe("holdBlocksWait", () => {
  it("lets a wait settle on a hold on the disk floor alone", () => {
    expect(holdBlocksWait({ hold: true, holdSubjects: ["disk"] })).toBe(false);
  });

  it("keeps a wait open on boots in flight, which clear themselves inside their window", () => {
    expect(holdBlocksWait({ hold: true, holdSubjects: ["boots"] })).toBe(true);
  });

  it("keeps a wait open on a hold naming no subject, and settles with no hold at all", () => {
    expect(holdBlocksWait({ hold: true, holdSubjects: [] })).toBe(true);
    expect(holdBlocksWait({ hold: false, holdSubjects: [] })).toBe(false);
  });
});
