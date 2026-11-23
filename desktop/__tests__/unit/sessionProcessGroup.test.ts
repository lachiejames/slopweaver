/*
 * The quit sweep: every session's process group is sent SIGTERM, given the grace together, and whatever is still alive
 * after it is sent SIGKILL — so a stopped group, which cannot catch SIGTERM, still does not outlive the app. Driven
 * over a fake clock and a fake process table (a seam, not a mock).
 */
import { describe, expect, it } from "vitest";

import { endGroupsBeforeExit, type GroupSignals } from "../../src/sessionProcessGroup";

/**
 * A process table where a group leaves on SIGTERM unless it is stopped, and always on SIGKILL — at once, or, with
 * `killLags`, only by the next pause, the way the kernel reaps a killed process after the signal is delivered.
 */
function fakeTable({ stopped, killLags = false }: { stopped: ReadonlySet<number>; killLags?: boolean }): {
  signals: GroupSignals;
  sent: string[];
  alive: Set<number>;
} {
  const alive = new Set<number>();
  const dying = new Set<number>();
  const sent: string[] = [];
  let clock = 0;
  return {
    alive,
    sent,
    signals: {
      alive: ({ pgid }) => alive.has(pgid),
      now: () => clock,
      pause: ({ ms }) => {
        clock += ms;
        for (const pgid of dying) {
          alive.delete(pgid);
        }
        dying.clear();
      },
      signal: ({ pgid, signal }) => {
        sent.push(`${signal} ${String(pgid)}`);
        if (signal === "SIGKILL" && killLags) {
          dying.add(pgid);
        } else if (signal === "SIGKILL" || !stopped.has(pgid)) {
          alive.delete(pgid);
        }
      },
    },
  };
}

describe("endGroupsBeforeExit", () => {
  it("ends a group that leaves on SIGTERM without SIGKILL", () => {
    const table = fakeTable({ stopped: new Set() });
    table.alive.add(101);
    expect(endGroupsBeforeExit({ graceMs: 5_000, pgids: [101], signals: table.signals })).toEqual([]);
    expect(table.sent).toEqual(["SIGTERM 101"]);
    expect([...table.alive]).toEqual([]);
  });

  it("SIGKILLs a stopped group once the grace is out, and only that one", () => {
    const table = fakeTable({ stopped: new Set([202]) });
    table.alive.add(101);
    table.alive.add(202);
    expect(endGroupsBeforeExit({ graceMs: 5_000, pgids: [101, 202], signals: table.signals })).toEqual([202]);
    expect(table.sent).toEqual(["SIGTERM 101", "SIGTERM 202", "SIGKILL 202"]);
    expect([...table.alive]).toEqual([]);
  });

  it("does not return until a SIGKILLed group is actually gone", () => {
    const table = fakeTable({ killLags: true, stopped: new Set([202]) });
    table.alive.add(202);
    expect(endGroupsBeforeExit({ graceMs: 5_000, pgids: [202], signals: table.signals })).toEqual([202]);
    expect([...table.alive]).toEqual([]);
  });

  it("signals nothing when no session is hosted", () => {
    const table = fakeTable({ stopped: new Set() });
    expect(endGroupsBeforeExit({ graceMs: 5_000, pgids: [], signals: table.signals })).toEqual([]);
    expect(table.sent).toEqual([]);
  });
});
