/**
 * The gauge slice's two rebuilders, read directly: a plan row per fresh reading that carries a Fable week, the
 * Ultra shape's missing five-hour window carried as absent, and a note for every plan left out.
 */
import { describe, expect, it } from "vitest";

import { accountGaugeOf, chairPlanGaugeOf, gaugePlansOf, planGaugeOf } from "../../../supervisor/tickGaugeShapes.js";

/** The usage policy `claude gauge --json` prints beside each swept plan's reading: a weekly window, no limit set. */
const POLICY = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 } as const;

const FRAME = { capturedIso: "2026-11-02T08:05:00.000Z", startedIso: "2026-11-02T08:00:00.000Z" };
const FRESH = "2026-11-02T08:01:00.000Z";
const RESET = "2026-11-06T19:00:00.000Z";

/** One window reading, resetting at a fixed instant. */
function window({ utilization }: { utilization: number }): {
  resetAtIso: string;
  status: "allowed";
  utilization: number;
} {
  return { resetAtIso: RESET, status: "allowed", utilization };
}

describe("accountGaugeOf", () => {
  it("omits the five-hour window when the reading carries none — the Ultra shape", () => {
    const gauge = accountGaugeOf({
      reading: { alias: "plan-one", observedAtIso: FRESH, sevenDay: window({ utilization: 0.4 }) },
    });
    expect(gauge).toStrictEqual({ alias: "plan-one", observedAtIso: FRESH, sevenDay: window({ utilization: 0.4 }) });
  });

  it("keeps the five-hour and Fable windows when both are read", () => {
    const gauge = accountGaugeOf({
      reading: {
        alias: "plan-two",
        fiveHour: window({ utilization: 0.1 }),
        observedAtIso: FRESH,
        sevenDay: window({ utilization: 0.4 }),
        sevenDayFable: window({ utilization: 0.2 }),
      },
    });
    expect(gauge.fiveHour).toStrictEqual(window({ utilization: 0.1 }));
    expect(gauge.sevenDayFable).toStrictEqual(window({ utilization: 0.2 }));
  });
});

describe("planGaugeOf", () => {
  it("pairs a reading with the usage policy the gauge printed beside it", () => {
    const gauge = planGaugeOf({
      reading: {
        alias: "plan-one",
        allowance: { kind: "weekly-window" },
        observedAtIso: FRESH,
        sevenDay: window({ utilization: 0.4 }),
        usageLimitPercent: 30,
      },
    });
    expect(gauge).toStrictEqual({
      alias: "plan-one",
      allowance: { kind: "weekly-window" },
      observedAtIso: FRESH,
      sevenDay: window({ utilization: 0.4 }),
      usageLimitPercent: 30,
    });
  });

  it("answers undefined for a reading with no usage limit, never one judged as if it had none", () => {
    const gauge = planGaugeOf({
      reading: {
        alias: "plan-one",
        allowance: { kind: "weekly-window" },
        observedAtIso: FRESH,
        sevenDay: window({ utilization: 0.4 }),
      },
    });
    expect(gauge).toBe(undefined);
  });

  it("answers undefined for a reading with no allowance", () => {
    const gauge = planGaugeOf({
      reading: {
        alias: "plan-one",
        observedAtIso: FRESH,
        sevenDay: window({ utilization: 0.4 }),
        usageLimitPercent: 30,
      },
    });
    expect(gauge).toBe(undefined);
  });
});

describe("chairPlanGaugeOf", () => {
  it("decodes a paused chair reading written without a policy as the register does, a weekly window at 100%", () => {
    const gauge = chairPlanGaugeOf({
      reading: { alias: "plan-paused", observedAtIso: FRESH, sevenDay: window({ utilization: 0.95 }) },
    });
    expect(gauge).toStrictEqual({
      alias: "plan-paused",
      allowance: { kind: "weekly-window" },
      observedAtIso: FRESH,
      sevenDay: window({ utilization: 0.95 }),
      usageLimitPercent: 100,
    });
  });

  it("carries the paused chair reading's own 50% limit and allowance onto the plan gauge, unchanged", () => {
    const gauge = chairPlanGaugeOf({
      reading: {
        alias: "plan-paused",
        allowance: { kind: "weekly-window" },
        observedAtIso: FRESH,
        sevenDay: window({ utilization: 0.475 }),
        usageLimitPercent: 50,
      },
    });
    expect(gauge).toStrictEqual({
      alias: "plan-paused",
      allowance: { kind: "weekly-window" },
      observedAtIso: FRESH,
      sevenDay: window({ utilization: 0.475 }),
      usageLimitPercent: 50,
    });
  });
});

describe("gaugePlansOf", () => {
  it("rows a fresh Ultra plan without fiveHourPct, and notes an unread, a stale and a Fable-less plan", () => {
    const result = gaugePlansOf({
      frame: FRAME,
      plans: [
        {
          alias: "plan-one",
          gauge: {
            ...POLICY,
            alias: "plan-one",
            observedAtIso: FRESH,
            sevenDay: window({ utilization: 0.856 }),
            sevenDayFable: window({ utilization: 0.31 }),
          },
        },
        { alias: "plan-two", problem: "no login" },
        {
          alias: "plan-three",
          gauge: {
            ...POLICY,
            alias: "plan-three",
            observedAtIso: "2026-11-02T07:00:00.000Z",
            sevenDay: window({ utilization: 0.1 }),
            sevenDayFable: window({ utilization: 0.1 }),
          },
        },
        {
          alias: "plan-four",
          gauge: { ...POLICY, alias: "plan-four", observedAtIso: FRESH, sevenDay: window({ utilization: 0.5 }) },
        },
      ],
    });
    expect(result.rows).toStrictEqual([
      { fablePct: 31, fableResetsIso: RESET, plan: "plan-one", resetsIso: RESET, usageLimitPercent: 100, weekPct: 86 },
    ]);
    expect(result.gauges.map((gauge) => gauge.alias)).toStrictEqual(["plan-one", "plan-four"]);
    expect(result.notes).toStrictEqual([
      "plan-two was not read: no login",
      "plan-three was read at 2026-11-02T07:00:00.000Z, before this tick started",
      "plan-four carried no Fable week window, so it has no complete row",
    ]);
    expect(result.weekOnly).toStrictEqual([{ plan: "plan-four", usageLimitPercent: 100, weekPct: 50 }]);
  });

  it("carries each window's OWN reset, never the all-models week's for every window", () => {
    const result = gaugePlansOf({
      frame: FRAME,
      plans: [
        {
          alias: "plan-five",
          gauge: {
            alias: "plan-five",
            allowance: { kind: "weekly-window" },
            fiveHour: { resetAtIso: "2026-11-02T12:00:00.000Z", status: "allowed", utilization: 0.1 },
            observedAtIso: FRESH,
            sevenDay: { resetAtIso: "2026-11-08T03:00:00.000Z", status: "allowed", utilization: 0.57 },
            sevenDayFable: { resetAtIso: "2026-11-04T11:00:00.000Z", status: "rejected", utilization: 1 },
            usageLimitPercent: 100,
          },
        },
      ],
    });
    expect(result.rows).toStrictEqual([
      {
        fablePct: 100,
        fableResetsIso: "2026-11-04T11:00:00.000Z",
        fiveHourPct: 10,
        fiveHourResetsIso: "2026-11-02T12:00:00.000Z",
        plan: "plan-five",
        resetsIso: "2026-11-08T03:00:00.000Z",
        usageLimitPercent: 100,
        weekPct: 57,
      },
    ]);
  });

  it("keeps the row of a plan whose reading carried no usage policy, but leaves it out of what the alerts judge", () => {
    const result = gaugePlansOf({
      frame: FRAME,
      plans: [
        {
          alias: "plan-one",
          gauge: {
            alias: "plan-one",
            observedAtIso: FRESH,
            sevenDay: window({ utilization: 0.4 }),
            sevenDayFable: window({ utilization: 0.2 }),
          },
        },
      ],
    });
    expect(result.rows).toStrictEqual([
      { fablePct: 20, fableResetsIso: RESET, plan: "plan-one", resetsIso: RESET, weekPct: 40 },
    ]);
    expect(result.gauges).toStrictEqual([]);
    expect(result.notes).toStrictEqual(["plan-one carried no usage policy, so no alert judges it"]);
  });

  it("returns nothing for an empty plan list", () => {
    expect(gaugePlansOf({ frame: FRAME, plans: [] })).toStrictEqual({ gauges: [], notes: [], rows: [], weekOnly: [] });
  });
});
