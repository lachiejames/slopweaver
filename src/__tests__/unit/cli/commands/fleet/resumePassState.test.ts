/**
 * One recovery pass's own record: what a refusal prints and journals, how the finish line judges the attempt, and
 * that the lock is released when it closes. Every journal lives in an in-memory fleet store; every lock in a
 * throwaway runtime directory.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  finish,
  journal,
  nowIso,
  pause,
  refusePass,
  refuseSeat,
} from "../../../../../cli/commands/fleet/resumePassState.js";
import { acquireFleetLock } from "../../../../../fleet/locks.js";
import { unwrap } from "../../../../../lib/result.js";
import { memoryFleetPort, unavailableFleetPort } from "../../../../fleetStoreFixture.js";
import { makeHome, passState } from "./fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const NO_NAMES = { emailFor: () => undefined };

describe("nowIso and pause", () => {
  it("writes the instant as a UTC ISO-8601 string that round-trips", () => {
    const text = nowIso();
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(text).toISOString()).toBe(text);
  });

  it("resolves after the wait", async () => {
    await expect(pause({ ms: 1 })).resolves.toBeUndefined();
  });
});

describe("journal", () => {
  it("appends one event the journal reads back whole", async () => {
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    const took = await journal({
      event: {
        atIso: "2026-10-04T05:00:00.000Z",
        attemptId: state.attemptId,
        episodeId: "ep-1",
        kind: "attempt-started",
        pid: 99,
        schemaVersion: 1,
      },
      state,
    });
    expect(took).toBe(true);
    const read = unwrap(await fleet.readResumeJournal({ home }));
    expect(read.unreadable).toBe(0);
    expect(read.events).toEqual([
      {
        atIso: "2026-10-04T05:00:00.000Z",
        attemptId: "att-1",
        episodeId: "ep-1",
        kind: "attempt-started",
        pid: 99,
        schemaVersion: 1,
      },
    ]);
  });

  it("answers false, the pass carrying on, when the store cannot be reached", async () => {
    const state = passState({ fleet: unavailableFleetPort(), home });
    const took = await journal({
      event: {
        atIso: "2026-10-04T05:00:00.000Z",
        attemptId: "att-1",
        kind: "attempt-finished",
        outcome: "healthy",
        schemaVersion: 1,
      },
      state,
    });
    expect(took).toBe(false);
  });
});

describe("refusePass", () => {
  it("records a refusal about the whole pass, prints it, and keeps it for the finish line", () => {
    const state = passState({ fleet: memoryFleetPort(), home });
    const refusal = { code: "NO_CHAIR_PIN", message: "no supervisor pin is recorded" } as const;
    refusePass({ refusal, state });
    expect(state.passRefusal).toBe(refusal);
    expect(state.refusals).toEqual([refusal]);
    expect(state.lines).toEqual(["fleet\trefused NO_CHAIR_PIN — no supervisor pin is recorded"]);
  });
});

describe("refuseSeat", () => {
  it("prints the workspace, journals a refused seat line and carries the session id", async () => {
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    const refusal = { code: "BUSY", message: "mid-turn", workspaceRef: "workspace:4" } as const;
    await refuseSeat({ refusal, role: "worker", sessionId: "sess-4", state });
    expect(state.refusals).toEqual([refusal]);
    expect(state.lines).toEqual(["workspace:4\trefused BUSY — mid-turn"]);
    const events = unwrap(await fleet.readResumeJournal({ home })).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "seat",
      phase: "refused",
      refusal: { code: "BUSY", workspaceRef: "workspace:4" },
      role: "worker",
      sessionId: "sess-4",
      workspaceRef: "workspace:4",
    });
  });

  it("names the role when the refusal carries no workspace, and omits an unknown session id", async () => {
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    await refuseSeat({
      refusal: { code: "NO_MODEL", message: "no model" },
      role: "supervisor",
      sessionId: undefined,
      state,
    });
    expect(state.lines).toEqual(["supervisor\trefused NO_MODEL — no model"]);
    const seat = unwrap(await fleet.readResumeJournal({ home })).events[0]!;
    expect(seat).toMatchObject({ kind: "seat", role: "supervisor", workspaceRef: "supervisor" });
    expect(Object.keys(seat)).not.toContain("sessionId");
  });

  it("journals a held seat when asked", async () => {
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    const refusal = { code: "CRASH_LOOP", message: "3 times", workspaceRef: "workspace:9" } as const;
    await refuseSeat({ phase: "held", refusal, role: "worker", sessionId: undefined, state });
    expect(state.lines).toEqual(["workspace:9\theld CRASH_LOOP — 3 times"]);
    expect(unwrap(await fleet.readResumeJournal({ home })).events[0]).toMatchObject({ kind: "seat", phase: "held" });
  });
});

describe("finish", () => {
  it("closes a clean pass as healthy, journals the outcome and releases the lock", async () => {
    const fleet = memoryFleetPort();
    const held = unwrap(acquireFleetLock({ home, nowIso: "2026-10-04T05:00:00.000Z" }));
    const state = { ...passState({ fleet, home }), releaseLock: held.release };
    const completion = await finish({ accounts: NO_NAMES, state });
    expect(completion).toEqual({
      finishJournalled: true,
      result: { attemptId: "att-1", lines: [], outcome: "healthy", refusals: [] },
    });
    expect(acquireFleetLock({ home, nowIso: "2026-10-04T05:00:01.000Z" }).isOk()).toBe(true);
    const events = unwrap(await fleet.readResumeJournal({ home })).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attemptId: "att-1", kind: "attempt-finished", outcome: "healthy" });
  });

  it("closes a deferred pass as deferred", async () => {
    const state = passState({ fleet: memoryFleetPort(), home });
    state.deferred = true;
    expect((await finish({ accounts: NO_NAMES, state })).result.outcome).toBe("deferred");
  });

  it("says the finish line was not journalled when the store will not take it, and still releases the lock", async () => {
    const held = unwrap(acquireFleetLock({ home, nowIso: "2026-10-04T05:00:00.000Z" }));
    const state = { ...passState({ fleet: unavailableFleetPort(), home }), releaseLock: held.release };
    const completion = await finish({ accounts: NO_NAMES, state });
    expect(completion.finishJournalled).toBe(false);
    expect(completion.result.outcome).toBe("healthy");
    expect(acquireFleetLock({ home, nowIso: "2026-10-04T05:00:01.000Z" }).isOk()).toBe(true);
  });

  it("closes a pass holding a real refusal as failed, carrying the pass refusal onto the finish line", async () => {
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    refusePass({ refusal: { code: "NO_CHAIR_PIN", message: "no pin" }, state });
    const { result } = await finish({ accounts: NO_NAMES, state });
    expect(result.outcome).toBe("failed");
    expect(result.refusals).toEqual([{ code: "NO_CHAIR_PIN", message: "no pin" }]);
    const finished = unwrap(await fleet.readResumeJournal({ home })).events.at(-1)!;
    expect(finished).toMatchObject({
      kind: "attempt-finished",
      outcome: "failed",
      refusal: { code: "NO_CHAIR_PIN", message: "no pin" },
    });
  });
});
