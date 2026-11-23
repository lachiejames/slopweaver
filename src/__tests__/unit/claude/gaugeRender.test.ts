import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowStatus } from "../../../claude/contracts.js";
import type { ClaudeAliasAccountCell } from "../../../claude/gaugeRender.js";
import { renderGaugeLines } from "../../../claude/gaugeRender.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** Days after the gauge was taken, so no weekly bar lifts. */
const WEEK_RESET = "2026-09-06T22:00:00.000Z";

/** The gauge lines under the default thresholds, which every case not about a threshold is judged by. */
const renderLines = (args: Omit<Parameters<typeof renderGaugeLines>[0], "thresholds">): readonly string[] =>
  renderGaugeLines({ ...args, thresholds: THRESHOLDS });

/** A weekly-window plan's reading; no usage limit set unless a case names one. */
function gauge({
  alias,
  fable,
  fiveHour = 0.1,
  sevenDay = 0.1,
  sevenDayStatus = "allowed",
  usageLimitPercent = 100,
  weekReset = WEEK_RESET,
}: {
  alias: string;
  fable?: number;
  fiveHour?: number;
  sevenDay?: number;
  sevenDayStatus?: ClaudeWindowStatus;
  usageLimitPercent?: UsageLimitPercent;
  weekReset?: string;
}): ClaudePlanGauge {
  return {
    alias,
    allowance: WEEKLY_WINDOW,
    fiveHour: { resetAtIso: "2026-09-04T04:10:00.000Z", status: "allowed", utilization: fiveHour },
    observedAtIso: "2026-09-04T00:00:00.000Z",
    sevenDay: { resetAtIso: weekReset, status: sevenDayStatus, utilization: sevenDay },
    ...(fable === undefined ? {} : { sevenDayFable: { resetAtIso: weekReset, status: "allowed", utilization: fable } }),
    usageLimitPercent,
  };
}

describe("renderGaugeLines", () => {
  it("renders the three plans measured live, one line each", () => {
    const lines = renderLines({
      cells: [],
      active: "plan-three",
      gauges: [
        gauge({ alias: "plan-one", fiveHour: 0, sevenDay: 0 }),
        gauge({ alias: "plan-two", fiveHour: 0, sevenDay: 0.2 }),
        gauge({ alias: "plan-three", fiveHour: 0.32, sevenDay: 0.64 }),
      ],
      reserved: "plan-three",
    });
    expect(lines[1]).toContain("plan-one");
    expect(lines[1]).toContain("0%");
    expect(lines[2]).toContain("20%");
    expect(lines[3]).toContain("64%");
  });

  it("marks the plan in the chair and the plan held for the browser", () => {
    const lines = renderLines({
      cells: [],
      active: "plan-three",
      gauges: [gauge({ alias: "plan-one" }), gauge({ alias: "plan-three" })],
      reserved: "plan-three",
    });
    expect(lines[1]).toContain("plan-one  ");
    expect(lines[2]).toContain("plan-three*B");
  });

  it("flags a window the provider refused as SPENT", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "p", sevenDayStatus: "rejected" })] });
    expect(lines[1]).toContain("SPENT");
  });

  it("flags an approaching-limit warning as NEAR, which is the proactive signal", () => {
    const lines = renderLines({
      cells: [],
      gauges: [gauge({ alias: "p", sevenDayStatus: "allowed_warning" })],
    });
    expect(lines[1]).toContain("NEAR");
  });

  it("flags a window past the rotation threshold as NEAR even while the provider still allows it", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "p", sevenDay: 0.96 })] });
    expect(lines[1]).toContain("NEAR");
  });

  it("moves NEAR with the install's routing bar: 96% is NEAR by default and unflagged once the bar is 0.98", () => {
    const gauges = [gauge({ alias: "p", sevenDay: 0.96 })];
    const raised = renderGaugeLines({ cells: [], gauges, thresholds: { ...THRESHOLDS, routeAt: 0.98 } });
    expect(raised[1]).not.toContain("NEAR");
    expect(renderLines({ cells: [], gauges })[1]).toContain("NEAR");
  });

  it("leaves an unlimited week blank at 97% in its last five hours, where routing spends it out", () => {
    const lines = renderLines({
      cells: [],
      gauges: [gauge({ alias: "p", sevenDay: 0.97, weekReset: "2026-09-04T03:00:00.000Z" })],
    });
    expect(lines[1]).toBe(
      "p       UNREAD        #.........  10%       ##########  97%       unread       2026-09-04T03:00:00.000Z",
    );
  });

  it("flags a 50%-limited week NEAR at its usage limit, where routing stops, and not a hair below", () => {
    const below = renderLines({ cells: [], gauges: [gauge({ alias: "p", sevenDay: 0.4999, usageLimitPercent: 50 })] });
    const at = renderLines({ cells: [], gauges: [gauge({ alias: "p", sevenDay: 0.5, usageLimitPercent: 50 })] });
    expect(below[1]).toBe(
      "p       UNREAD        #.........  10%       #####.....  50%       unread       2026-09-06T22:00:00.000Z",
    );
    expect(at[1]).toBe(
      "p       UNREAD        #.........  10%  NEAR #####.....  50%       unread       2026-09-06T22:00:00.000Z",
    );
  });

  it("keeps a limited week NEAR at its limit inside the last five hours, since a usage limit never lifts", () => {
    const lines = renderLines({
      cells: [],
      gauges: [gauge({ alias: "p", sevenDay: 0.5, usageLimitPercent: 50, weekReset: "2026-09-04T03:00:00.000Z" })],
    });
    expect(lines[1]).toContain("NEAR #####.....  50%");
  });

  it("rebases a limited plan's Fable week on its limit too", () => {
    const below = renderLines({
      cells: [],
      gauges: [gauge({ alias: "p", fable: 0.4999, sevenDay: 0.2, usageLimitPercent: 50 })],
    });
    const at = renderLines({
      cells: [],
      gauges: [gauge({ alias: "p", fable: 0.5, sevenDay: 0.2, usageLimitPercent: 50 })],
    });
    expect(below[1]).toBe(
      "p       UNREAD        #.........  10%       ##........  20%       #####.....  50%  2026-09-06T22:00:00.000Z",
    );
    expect(at[1]).toBe(
      "p       UNREAD        #.........  10%       ##........  20%  NEAR #####.....  50%  2026-09-06T22:00:00.000Z",
    );
  });

  it("never rebases a monthly-spend plan's week, whose usage limit is a share of the month", () => {
    const monthly: ClaudePlanGauge = {
      ...gauge({ alias: "p", sevenDay: 0.5, usageLimitPercent: 50 }),
      allowance: { kind: "monthly-spend" },
    };
    const lines = renderLines({ cells: [], gauges: [monthly] });
    expect(lines[1]).toBe(
      "p       UNREAD        #.........  10%       #####.....  50%       unread       2026-09-06T22:00:00.000Z",
    );
  });

  it("never rebases a limited plan's five-hour window, which is a share of five hours, not of the week", () => {
    const half = renderLines({ cells: [], gauges: [gauge({ alias: "p", fiveHour: 0.6, usageLimitPercent: 50 })] });
    const routed = renderLines({ cells: [], gauges: [gauge({ alias: "p", fiveHour: 0.95, usageLimitPercent: 50 })] });
    expect(half[1]).toBe(
      "p       UNREAD        ######....  60%       #.........  10%       unread       2026-09-06T22:00:00.000Z",
    );
    expect(routed[1]).toBe(
      "p       UNREAD   NEAR ##########  95%       #.........  10%       unread       2026-09-06T22:00:00.000Z",
    );
  });

  it("leaves a healthy plan unflagged, so a flag means something", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "p" })] });
    expect(lines[1]).not.toContain("NEAR");
    expect(lines[1]).not.toContain("SPENT");
  });

  it("draws a full bar for a spent window and an empty one for an untouched plan", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "p", fiveHour: 1, sevenDay: 0 })] });
    expect(lines[1]).toContain("##########");
    expect(lines[1]).toContain("..........");
  });

  it("renders an alias and never an email or an organisation", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "plan-one" })] });
    expect(lines.join("\n")).not.toContain("@");
  });

  it("carries a legend, so the two marks are not undefined labels", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "p" })] });
    expect(lines[lines.length - 1]).toContain("in the chair");
    expect(lines[lines.length - 1]).toContain("held for the browser");
  });

  it("prints each plan's account beside its alias, and UNMAPPED for one nothing names an address for", () => {
    const cells: readonly ClaudeAliasAccountCell[] = [
      { alias: "plan-one", cell: { trust: "unmapped" } },
      { alias: "plan-two", cell: { address: "security@example.invalid", trust: "bound" } },
    ];
    const lines = renderLines({ cells, gauges: [gauge({ alias: "plan-one" }), gauge({ alias: "plan-two" })] });
    expect(lines[0]!.startsWith("plan        account                   5-hour")).toBe(true);
    expect(lines[1]!.startsWith("plan-one    UNMAPPED                  ")).toBe(true);
    expect(lines[2]!.startsWith("plan-two    security@example.invalid  ")).toBe(true);
  });

  it("prints no address at all for a store whose token is not the enrolled account", () => {
    const lines = renderLines({
      cells: [{ alias: "plan-one", cell: { trust: "wrong-account" } }],
      gauges: [gauge({ alias: "plan-one" })],
    });
    expect(lines[1]!.startsWith("plan-one    WRONG ACCOUNT  ")).toBe(true);
    expect(lines.join("\n")).not.toContain("@");
  });

  it("says CACHED for an address accounts.json holds and no enrollment ever bound", () => {
    const lines = renderLines({
      cells: [{ alias: "plan-one", cell: { address: "cache@example.invalid", trust: "cached" } }],
      gauges: [gauge({ alias: "plan-one" })],
    });
    expect(lines[1]!.startsWith("plan-one    CACHED cache@example.invalid  ")).toBe(true);
  });

  it("prefers the BOUND address and names the drifted cache second", () => {
    const lines = renderLines({
      cells: [
        {
          alias: "plan-one",
          cell: { address: "bound@example.invalid", staleCache: "drifted@example.invalid", trust: "bound-cache-stale" },
        },
      ],
      gauges: [gauge({ alias: "plan-one" })],
    });
    expect(
      lines[1]!.startsWith("plan-one    bound@example.invalid (accounts.json says drifted@example.invalid)  "),
    ).toBe(true);
  });

  it("reads UNREAD for a gauge the shell decided no cell for, never a blank that looks fine", () => {
    const lines = renderLines({ cells: [], gauges: [gauge({ alias: "plan-one" })] });
    expect(lines[1]!.startsWith("plan-one    UNREAD  ")).toBe(true);
  });
});
