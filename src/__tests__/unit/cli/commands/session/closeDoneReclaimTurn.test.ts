/**
 * `close-done`'s pacing: one sweep lets at most one closed seat's tree reach a removal, and none while the load
 * gate is shut, so a sweep closing five acme-admin seats never deletes five trees back to back (the r3 Opus review).
 */
import { describe, expect, it } from "vitest";

import { type ClosedSeat, reclaimInTurn } from "../../../../../cli/commands/session/closeDoneReclaim.js";

/** A closed seat named `name`. */
const seat = ({ name }: { name: string }): ClosedSeat => ({
  directory: `/w/.claude/worktrees/${name}`,
  name,
  sessionKey: name,
  workspaceId: `id-${name}`,
});

const SEATS = [seat({ name: "a" }), seat({ name: "b" }), seat({ name: "c" })];

/** A reclaim that removes every tree it is not paused for, recording what it was told. */
const recording = (): {
  told: string[];
  reclaim: Parameters<typeof reclaimInTurn>[0]["reclaim"];
} => {
  const told: string[] = [];
  return {
    reclaim: ({ seat: closed, paused }) => {
      told.push(`${closed.name}: ${String(paused)}`);
      const removed = paused === null;
      return {
        attempted: removed,
        result: { name: closed.name, path: closed.directory, reason: String(paused), removed },
      };
    },
    told,
  };
};

describe("reclaimInTurn", () => {
  it("lets the first seat's tree go and leaves every later one for the hourly prune", () => {
    const { reclaim, told } = recording();

    const outcomes = reclaimInTurn({ loadStop: () => null, reclaim, seats: SEATS });

    expect(outcomes.map((outcome) => outcome.removed)).toEqual([true, false, false]);
    expect(told).toEqual([
      "a: null",
      "b: this sweep already removed one tree",
      "c: this sweep already removed one tree",
    ]);
  });

  it("removes nothing while the load gate is shut", () => {
    const { reclaim, told } = recording();
    const shut = (): string => "the 1-minute load is 40.0, at or above the 22 hold";

    const outcomes = reclaimInTurn({ loadStop: shut, reclaim, seats: SEATS });

    expect(outcomes.map((outcome) => outcome.removed)).toEqual([false, false, false]);
    expect(told[0]).toBe("a: the 1-minute load is 40.0, at or above the 22 hold");
  });

  it("lets a later seat go when the earlier ones never reached a removal", () => {
    const told: string[] = [];
    const outcomes = reclaimInTurn({
      loadStop: () => null,
      reclaim: ({ seat: closed, paused }) => {
        told.push(`${closed.name}: ${String(paused)}`);
        const removed = closed.name === "b" && paused === null;
        return { attempted: removed, result: { name: closed.name, path: closed.directory, reason: "", removed } };
      },
      seats: SEATS,
    });

    expect(outcomes.map((outcome) => outcome.removed)).toEqual([false, true, false]);
    expect(told).toEqual(["a: null", "b: null", "c: this sweep already removed one tree"]);
  });

  it("answers nothing for no seats", () => {
    expect(reclaimInTurn({ loadStop: () => null, reclaim: recording().reclaim, seats: [] })).toEqual([]);
  });
});
