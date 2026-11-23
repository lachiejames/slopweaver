/*
 * A Codex turn's start as `PlanCall` counts it: a new turn tells every waiter on the next one, and a replayed start of
 * a turn already running tells none. Plain sets and functions; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { type TurnWaiter, turnStarted } from "../../lib/talkPlanTurns";

describe("turnStarted", () => {
  it("counts a new turn running, tells every waiter its id and clears them", () => {
    const told: (string | undefined)[] = [];
    const running = new Set<string>(["t-1"]);
    const waiters = new Set<TurnWaiter>([(id) => told.push(id), (id) => told.push(`second ${String(id)}`)]);
    turnStarted({ running, turnId: "t-2", waiters });
    expect([Array.from(running), told, waiters.size]).toEqual([["t-1", "t-2"], ["t-2", "second t-2"], 0]);
  });

  it("tells no waiter of a replayed start of a turn already running, and keeps them waiting", () => {
    const told: (string | undefined)[] = [];
    const running = new Set<string>(["t-1"]);
    const waiters = new Set<TurnWaiter>([(id) => told.push(id)]);
    turnStarted({ running, turnId: "t-1", waiters });
    expect([Array.from(running), told, waiters.size]).toEqual([["t-1"], [], 1]);
  });
});
