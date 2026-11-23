/*
 * The ceilings reading's routing — one route per provider through the plan its own ranker picks, a route bound by
 * the lesser of the machine and that plan, and the lowest unused ceiling being the selected route's limit.
 *
 * Every case asserts exact ids and headrooms, so a spent plan that starts blocking an open one, or an unread
 * plan that starts reading as spent, reddens here.
 */
import { describe, expect, it } from "vitest";

import { buildCeilingsReading } from "../../../../capacity/ceilings.js";
import { claude, codex, machine, NOW, pause, plans } from "../ceilingsFixtures.js";

describe("buildCeilingsReading", () => {
  it("binds on the machine when it has less headroom than the routed plan, and scales Claude to used of 100", () => {
    const reading = buildCeilingsReading({
      machine: machine({ load1: 16.5 }),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.35 })] }),
    });

    expect(reading.ceilings).toStrictEqual([
      {
        account: null,
        freeResets: null,
        headroom: 0.25,
        id: "machine",
        kind: "machine",
        reason: null,
        status: "open",
        windows: [{ available: 22, resetAtIso: null, used: 16.5, window: "load1" }],
      },
      {
        account: "plan-one@example.test",
        freeResets: null,
        headroom: 0.65,
        id: "claude:plan-one",
        kind: "claude",
        reason: null,
        status: "open",
        windows: [
          { available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 10, window: "five-hour" },
          { available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 35, window: "seven-day" },
        ],
      },
    ]);
    expect(reading.selectedRoute).toStrictEqual({
      driver: "claude",
      headroom: 0.25,
      limitingCeilingId: "machine",
      planCeilingId: "claude:plan-one",
    });
    expect(reading.lowest).toBe("machine");
  });

  it("binds on the plan when the plan has less headroom than the machine", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.2, sevenDay: 0.8 })] }),
    });

    expect(reading.lowest).toBe("claude:plan-one");
    expect(reading.selectedRoute).toStrictEqual({
      driver: "claude",
      headroom: 0.2,
      limitingCeilingId: "claude:plan-one",
      planCeilingId: "claude:plan-one",
    });
  });

  it("routes around a spent plan to an open one — one spent plan never stops the fleet", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [
          claude({ alias: "plan-five", fiveHour: 0.1, sevenDay: 1, status: "rejected" }),
          claude({ alias: "plan-two", fiveHour: 0.05, sevenDay: 0.36 }),
        ],
      }),
    });

    expect(reading.ceilings.map((ceiling) => [ceiling.id, ceiling.status, ceiling.headroom])).toStrictEqual([
      ["machine", "open", 0.9],
      ["claude:plan-five", "refusing", 0],
      ["claude:plan-two", "open", 0.64],
    ]);
    expect(reading.lowest).toBe("claude:plan-two");
  });

  it("leaves the Fable week out of an all-models headroom but shows it", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fable: 0.99, fiveHour: 0.1, sevenDay: 0.3 })] }),
    });
    const plan = reading.ceilings[1]!;

    expect(plan.headroom).toBe(0.7);
    expect(plan.windows.map((window) => window.window)).toStrictEqual(["five-hour", "seven-day", "fable-seven-day"]);
  });

  it("picks the route with the most headroom, Codex over a tighter Claude", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.7 })],
        codex: [codex({ alias: "codex-one", used: 50 })],
        codexRoutedAlias: "codex-one",
      }),
    });

    expect(reading.routes.map((route) => [route.driver, route.limitingCeilingId, route.headroom])).toStrictEqual([
      ["claude", "claude:plan-one", 0.3],
      ["codex", "codex:codex-one", 0.5],
    ]);
    expect(reading.selectedRoute!.driver).toBe("codex");
    expect(reading.lowest).toBe("codex:codex-one");
  });

  it("prefers Claude on a tie between routes", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.5 })],
        codex: [codex({ alias: "codex-one", used: 50 })],
        codexRoutedAlias: "codex-one",
      }),
    });

    expect(reading.selectedRoute!.driver).toBe("claude");
  });

  it("reads a held machine as zero headroom even at low load — a memory hold holds every spawn", () => {
    const reading = buildCeilingsReading({
      machine: machine({ hold: true, holdSubjects: ["memory"], load1: 1 }),
      observedAtIso: NOW,
      plans: plans({ claude: [claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.3 })] }),
    });

    expect(reading.ceilings[0]).toStrictEqual({
      account: null,
      freeResets: null,
      headroom: 0,
      id: "machine",
      kind: "machine",
      reason: "hold on memory",
      status: "held",
      windows: [{ available: 22, resetAtIso: null, used: 1, window: "load1" }],
    });
    expect(reading.selectedRoute).toBe(null);
    expect(reading.lowest).toBe("machine");
  });

  it("reads a paused plan as zero and an unreadable one as null, never as spent", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [
          {
            account: "CACHED three@example.test",
            alias: "plan-three",
            kind: "paused",
            pause,
            reason: "owner paused it",
          },
          { account: "UNREAD", alias: "plan-four", kind: "unreadable", problem: "probe timed out" },
        ],
        codex: [
          {
            account: "STORE MISSING",
            alias: "codex-two",
            exclusion: null,
            freeResets: null,
            usageLimitPercent: 100,
            windows: null,
          },
        ],
        problems: ["codex fleet: app-server did not answer"],
      }),
    });

    expect(reading.ceilings.slice(1)).toStrictEqual([
      {
        account: "CACHED three@example.test",
        freeResets: null,
        headroom: 0,
        id: "claude:plan-three",
        kind: "claude",
        pause,
        reason: "paused: owner paused it",
        status: "paused",
        windows: [],
      },
      {
        account: "UNREAD",
        freeResets: null,
        headroom: null,
        id: "claude:plan-four",
        kind: "claude",
        reason: "probe timed out",
        status: "unreadable",
        windows: [],
      },
      {
        account: "STORE MISSING",
        freeResets: null,
        headroom: null,
        id: "codex:codex-two",
        kind: "codex",
        reason: "no budget reading in its live read or its rollout log",
        status: "unreadable",
        windows: [],
      },
    ]);
    expect(reading.routes).toStrictEqual([]);
    expect(reading.lowest).toBe("machine");
    expect(reading.problems).toStrictEqual(["codex fleet: app-server did not answer"]);
  });

  it("grades a Codex exclusion as paused or refusing by its kind", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        codex: [
          { ...codex({ alias: "codex-one", used: 20 }), exclusion: { kind: "paused", reason: "paused by owner" } },
          { ...codex({ alias: "ambient", used: 100 }), exclusion: { kind: "near-cap", reason: "weekly at 100%" } },
        ],
      }),
    });

    expect(reading.ceilings.slice(1).map((ceiling) => [ceiling.id, ceiling.status, ceiling.headroom])).toStrictEqual([
      ["codex:codex-one", "paused", 0],
      ["codex:ambient", "refusing", 0],
    ]);
  });
});
