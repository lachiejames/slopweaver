/*
 * The Fleet page's history: each recorded tick judged by the badge's own rules, folded into spans of one state and
 * one cause, newest first — and the `fleet history --json` reader refusing a document with any part unread.
 */
import { describe, expect, it } from "vitest";

import { readFleetHistory } from "../../components/live/readFleetHistory";
import { fleetVerdictOf, type GlanceCapacity } from "../../lib/fleetGlance";
import type { GlancePlan } from "../../lib/fleetGlancePlans";
import {
  badgeReadAtOf,
  type FleetHistory,
  type HistoryTick,
  historyBehindBadge,
  historyPointOf,
  historySpansOf,
  newestTickIsoOf,
} from "../../lib/fleetHistory";
import { fleetStateKindOf } from "../../lib/fleetState";

/** The not-recorded words `src/fleet/stateHistory.ts` writes on every tick from before the count. */
const NOT_RECORDED = "this tick did not record whether a ready row lacked a session";

/** A machine with no hold and no plans read. */
const CALM: GlanceCapacity = { hold: false, holdSubjects: [], load1: 12.5, loadHold: 22, plans: { kind: "absent" } };

/** A machine holding on cpu. */
const HOT: GlanceCapacity = { ...CALM, hold: true, holdSubjects: ["cpu"], load1: 26.6 };

/** A Claude plan not taking new work. */
const SHUT: GlancePlan = {
  account: "plan-one@example.invalid",
  freeResets: undefined,
  id: "claude:plan-one",
  pause: undefined,
  provider: "claude",
  reason: "seven-day window at 100%",
  status: "held",
  windows: [{ available: 100, resetAtIso: "2026-10-12T00:00:00.000Z", used: 100, window: "seven-day" }],
};

/** One tick, finalised at the given minute past the hour the fixtures start on. */
function tick({
  minute,
  capacity = CALM,
  working = 4,
  openReadyCount,
}: {
  minute: number;
  capacity?: GlanceCapacity;
  working?: number;
  openReadyCount?: number;
}): HistoryTick {
  const atIso = `2026-10-10T01:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    atIso,
    capacity: { capacity, ceiling: { kind: "measured", seats: 6 }, kind: "read", observedAtIso: atIso },
    ready:
      openReadyCount === undefined ? { kind: "not-recorded", why: NOT_RECORDED } : { kind: "read", openReadyCount },
    tickId: `t${String(minute)}`,
    working: { kind: "read", working },
  };
}

/** A history over the given ticks. */
function historyOf({ ticks }: { ticks: readonly HistoryTick[] }): FleetHistory {
  return {
    fromIso: "2026-10-09T02:00:00.000Z",
    observedAtIso: "2026-10-10T02:00:00.000Z",
    reachedFrom: true,
    ticks,
    toIso: "2026-10-10T02:00:00.000Z",
  };
}

describe("historyBehindBadge", () => {
  const history = historyOf({ ticks: [tick({ minute: 0 }), tick({ minute: 5 })] });

  it("is behind once the badge reads after the newest tick was finalised", () => {
    expect(historyBehindBadge({ badgeReadAtIso: "2026-10-10T01:05:20.000Z", history })).toBe(true);
  });

  it("is level when the newest tick was finalised at or after the badge's reading", () => {
    expect([
      historyBehindBadge({ badgeReadAtIso: "2026-10-10T01:05:00.000Z", history }),
      historyBehindBadge({ badgeReadAtIso: "2026-10-10T01:04:59.000Z", history }),
    ]).toStrictEqual([false, false]);
  });

  it("calls an empty history behind any reading", () => {
    expect(historyBehindBadge({ badgeReadAtIso: "2026-10-10T01:00:00.000Z", history: historyOf({ ticks: [] }) })).toBe(
      true,
    );
  });
});

describe("newestTickIsoOf", () => {
  it("names the latest tick even when the rows arrive out of order, and nothing for an empty history", () => {
    expect([
      newestTickIsoOf({ history: historyOf({ ticks: [tick({ minute: 10 }), tick({ minute: 5 })] }) }),
      newestTickIsoOf({ history: historyOf({ ticks: [] }) }),
    ]).toStrictEqual(["2026-10-10T01:10:00.000Z", undefined]);
  });
});

describe("badgeReadAtOf", () => {
  it("takes the latest reading, so an older capacity reading never hides a newer sessions reading", () => {
    expect([
      badgeReadAtOf({ otherReadAtIsos: ["2026-10-10T01:00:00.000Z"], seatsReadAtIso: "2026-10-10T01:10:00.000Z" }),
      badgeReadAtOf({
        otherReadAtIsos: [undefined, "2026-10-10T01:12:00.000Z", "2026-10-10T01:11:00.000Z"],
        seatsReadAtIso: "2026-10-10T01:10:00.000Z",
      }),
      badgeReadAtOf({ otherReadAtIsos: [], seatsReadAtIso: "2026-10-10T01:10:00.000Z" }),
    ]).toStrictEqual(["2026-10-10T01:10:00.000Z", "2026-10-10T01:12:00.000Z", "2026-10-10T01:10:00.000Z"]);
  });
});

describe("historyPointOf", () => {
  it("holds on the machine, naming the subject, whatever the ready count", () => {
    expect(historyPointOf({ tick: tick({ capacity: HOT, minute: 0, openReadyCount: 3 }) })).toStrictEqual({
      atIso: "2026-10-10T01:00:00.000Z",
      cause: "cpu",
      kind: "holding-machine",
      working: 4,
    });
  });

  it("holds on the board when every ready row had a session, and picks up when one did not", () => {
    expect(historyPointOf({ tick: tick({ minute: 0, openReadyCount: 0 }) }).kind).toBe("holding-board");
    expect(historyPointOf({ tick: tick({ minute: 0, openReadyCount: 2 }) }).kind).toBe("picking-up");
  });

  it("is not measured, never picking up, below the ceiling on a tick that did not record the ready count", () => {
    expect(historyPointOf({ tick: tick({ minute: 0 }) })).toStrictEqual({
      atIso: "2026-10-10T01:00:00.000Z",
      cause: NOT_RECORDED,
      kind: "not-measured",
      working: 4,
    });
  });

  it("judges an unread board below the ceiling as the badge does: not measured, in both", () => {
    const badge = fleetStateKindOf({
      glance: fleetVerdictOf({
        capacity: CALM,
        ceiling: { kind: "measured", seats: 6 },
        nowIso: "2026-10-10T01:00:00.000Z",
        openReadyCount: undefined,
        working: 4,
      }),
    });

    expect([badge, historyPointOf({ tick: tick({ minute: 0 }) }).kind]).toStrictEqual(["not-measured", "not-measured"]);
  });

  it("holds on the plans when no Claude plan took new work", () => {
    const capacity: GlanceCapacity = { ...CALM, plans: { kind: "read", lowest: undefined, plans: [SHUT] } };

    expect(historyPointOf({ tick: tick({ capacity, minute: 0 }) }).kind).toBe("holding-plans");
  });

  it("is at capacity at the ceiling when the plans' week does not leave room", () => {
    const capacity: GlanceCapacity = {
      ...CALM,
      plans: {
        kind: "read",
        lowest: undefined,
        plans: [{ ...SHUT, reason: undefined, status: "open", windows: [{ ...SHUT.windows[0], used: 99 }] }],
      },
    };

    expect(historyPointOf({ tick: tick({ capacity, minute: 0, working: 6 }) }).kind).toBe("at-capacity");
  });

  it("judges the week's pace at the instant the tick read the plans, not when the tick finalised", () => {
    const halfWeek: GlanceCapacity = {
      ...CALM,
      plans: {
        kind: "read",
        lowest: undefined,
        plans: [
          {
            ...SHUT,
            reason: undefined,
            status: "open",
            windows: [{ available: 100, resetAtIso: "2026-10-17T00:00:00.000Z", used: 50, window: "seven-day" }],
          },
        ],
      },
    };
    const base = tick({ capacity: halfWeek, minute: 0, working: 4 });
    const read: HistoryTick = {
      ...base,
      atIso: "2026-10-13T12:01:00.000Z",
      capacity: {
        capacity: halfWeek,
        ceiling: { kind: "measured", seats: 4 },
        kind: "read",
        observedAtIso: "2026-10-13T12:00:00.000Z",
      },
    };

    const readLater: HistoryTick = {
      ...read,
      capacity: {
        capacity: halfWeek,
        ceiling: { kind: "measured", seats: 4 },
        kind: "read",
        observedAtIso: "2026-10-13T12:01:00.000Z",
      },
    };

    expect(historyPointOf({ tick: read }).kind).toBe("at-capacity");
    expect(historyPointOf({ tick: readLater }).kind).toBe("holding-pace");
  });

  it("is not measured when the tick did not read the sessions or the machine", () => {
    const blind: HistoryTick = { ...tick({ minute: 0 }), working: { kind: "unavailable", why: "watch timed out" } };
    const dark: HistoryTick = { ...tick({ minute: 0 }), capacity: { kind: "unavailable", why: "no load reading" } };

    expect(historyPointOf({ tick: blind })).toStrictEqual({
      atIso: "2026-10-10T01:00:00.000Z",
      cause: "the sessions were not read",
      kind: "not-measured",
      working: undefined,
    });
    expect(historyPointOf({ tick: dark }).cause).toBe("the machine was not read");
  });
});

describe("historySpansOf", () => {
  it("folds adjacent ticks of one state and cause into one span, newest first, with the working range", () => {
    const spans = historySpansOf({
      history: historyOf({
        ticks: [
          tick({ capacity: HOT, minute: 0, working: 4 }),
          tick({ capacity: HOT, minute: 20, working: 6 }),
          tick({ minute: 40, openReadyCount: 0, working: 5 }),
          tick({ capacity: HOT, minute: 59, working: 7 }),
        ],
      }),
    });

    expect(spans).toStrictEqual([
      {
        badge: "holding: machine busy",
        cause: "cpu",
        fromIso: "2026-10-10T01:59:00.000Z",
        kind: "holding-machine",
        ticks: 1,
        toIso: "2026-10-10T01:59:00.000Z",
        working: { high: 7, low: 7 },
      },
      {
        badge: "holding: nothing ready",
        cause: "",
        fromIso: "2026-10-10T01:40:00.000Z",
        kind: "holding-board",
        ticks: 1,
        toIso: "2026-10-10T01:40:00.000Z",
        working: { high: 5, low: 5 },
      },
      {
        badge: "holding: machine busy",
        cause: "cpu",
        fromIso: "2026-10-10T01:00:00.000Z",
        kind: "holding-machine",
        ticks: 2,
        toIso: "2026-10-10T01:20:00.000Z",
        working: { high: 6, low: 4 },
      },
    ]);
  });

  it("splits one state when its cause changes", () => {
    const memory: GlanceCapacity = { ...HOT, holdSubjects: ["memory"] };

    const spans = historySpansOf({
      history: historyOf({ ticks: [tick({ capacity: HOT, minute: 0 }), tick({ capacity: memory, minute: 20 })] }),
    });

    expect(spans.map((span) => span.cause)).toStrictEqual(["memory", "cpu"]);
  });

  it("is no span at all over an empty window", () => {
    expect(historySpansOf({ history: historyOf({ ticks: [] }) })).toStrictEqual([]);
  });
});

/** One row as `fleet history --json` prints it. */
function printedRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    atIso: "2026-10-10T01:00:00.000Z",
    capacity: {
      ceilings: null,
      hold: true,
      holdSubjects: ["cpu"],
      kind: "read",
      load1: 26.6,
      loadHold: 22,
      observedAtIso: "2026-10-10T00:59:00.000Z",
      seatCeiling: { kind: "measured", seats: 6 },
    },
    ready: { kind: "read", openReadyCount: 2 },
    tickId: "t1",
    working: { kind: "read", working: 6 },
    ...over,
  };
}

/** A whole document around the given rows. */
function printed({ rows }: { rows: readonly unknown[] }): Record<string, unknown> {
  return {
    fromIso: "2026-10-09T02:00:00.000Z",
    observedAtIso: "2026-10-10T02:00:00.000Z",
    reachedFrom: true,
    rows,
    toIso: "2026-10-10T02:00:00.000Z",
  };
}

/** The one tick a read produced; throws when the document did not read, or held none or several. */
function onlyTick({ history }: { history: FleetHistory | undefined }): HistoryTick {
  if (history === undefined) {
    throw new Error("the history document did not read");
  }
  const [only, ...rest] = history.ticks;
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected one tick, read ${String(history.ticks.length)}`);
  }
  return only;
}

describe("readFleetHistory", () => {
  it("orders the ticks oldest first, whatever order the rows arrived in", () => {
    const rows = [
      printedRow({ atIso: "2026-10-10T01:10:00.000Z", tickId: "newer" }),
      printedRow({ atIso: "2026-10-10T01:05:00.000Z", tickId: "older" }),
    ];

    expect(readFleetHistory(printed({ rows }))!.ticks.map((read) => read.tickId)).toStrictEqual(["older", "newer"]);
  });

  it("reads a document exactly, a recorded null ceilings as plans not carried", () => {
    expect(readFleetHistory(printed({ rows: [printedRow()] }))).toStrictEqual({
      fromIso: "2026-10-09T02:00:00.000Z",
      observedAtIso: "2026-10-10T02:00:00.000Z",
      reachedFrom: true,
      ticks: [
        {
          atIso: "2026-10-10T01:00:00.000Z",
          capacity: {
            capacity: { hold: true, holdSubjects: ["cpu"], load1: 26.6, loadHold: 22, plans: { kind: "absent" } },
            ceiling: { kind: "measured", seats: 6 },
            kind: "read",
            observedAtIso: "2026-10-10T00:59:00.000Z",
          },
          ready: { kind: "read", openReadyCount: 2 },
          tickId: "t1",
          working: { kind: "read", working: 6 },
        },
      ],
      toIso: "2026-10-10T02:00:00.000Z",
    });
  });

  it("reads an old tick's unrecorded hold load and seat ceiling as not carried", () => {
    const row = printedRow({
      capacity: {
        ceilings: null,
        hold: false,
        holdSubjects: [],
        kind: "read",
        load1: 9,
        loadHold: null,
        observedAtIso: "2026-10-10T00:59:00.000Z",
        seatCeiling: null,
      },
      ready: { kind: "not-recorded", why: NOT_RECORDED },
    });

    const tickRead = onlyTick({ history: readFleetHistory(printed({ rows: [row] })) });

    expect(tickRead.capacity).toStrictEqual({
      capacity: { hold: false, holdSubjects: [], load1: 9, loadHold: undefined, plans: { kind: "absent" } },
      ceiling: undefined,
      kind: "read",
      observedAtIso: "2026-10-10T00:59:00.000Z",
    });
    expect(tickRead.ready).toStrictEqual({ kind: "not-recorded", why: NOT_RECORDED });
  });

  it("refuses the whole document when one row will not read", () => {
    const broken = printedRow({ working: { kind: "read" } });

    expect(readFleetHistory(printed({ rows: [printedRow(), broken] }))).toBe(undefined);
  });

  it("refuses a capacity row missing a key the producer always writes, rather than reading it as unrecorded", () => {
    const capacity = {
      ceilings: null,
      hold: false,
      holdSubjects: [],
      kind: "read",
      load1: 9,
      observedAtIso: "2026-10-10T00:59:00.000Z",
      seatCeiling: null,
    };

    expect(readFleetHistory(printed({ rows: [printedRow({ capacity })] }))).toBe(undefined);
  });

  it("refuses a ceilings reading that will not read", () => {
    const capacity = { ...(printedRow()["capacity"] as Record<string, unknown>), ceilings: { ceilings: "no" } };

    expect(readFleetHistory(printed({ rows: [printedRow({ capacity })] }))).toBe(undefined);
  });
});
