/**
 * The per-turn usage gate's decision table: a seat running on a plan with a usage limit is held at the limit, and
 * held as NOT MEASURED when no recorded reading young enough says it is under it. Nothing else holds it.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeWindowReading } from "../../../claude/contracts.js";
import type { ClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshot.js";
import {
  CLAUDE_USAGE_READING_FRESH_MS,
  monthlySeatUsageVerdict,
  seatUsageHoldLines,
  seatUsageNotMeasured,
  weeklySeatUsageVerdict,
} from "../../../claude/seatUsageGate.js";
import type { ClaudeSpendReading } from "../../../claude/spendPolicy.js";

const NOW = "2026-11-05T12:00:00.000Z";
const OBSERVED = "2026-11-05T11:50:00.000Z";
const WEEK_RESET = "2026-11-08T12:00:00.000Z";
const FABLE_RESET = "2026-11-07T12:00:00.000Z";

/** Epoch seconds of an instant, as the cached pass carries them. */
function epochSeconds({ iso }: { iso: string }): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** One weekly window. */
function window({
  resetAtIso = WEEK_RESET,
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading {
  return { resetAtIso, status, utilization };
}

/** A snapshot of plan-one observed ten minutes before now. */
function snapshot(over: Partial<ClaudePlanUsageSnapshot>): ClaudePlanUsageSnapshot {
  return { alias: "plan-one", observedAtIso: OBSERVED, sevenDay: window({ utilization: 0.1 }), ...over };
}

describe("weeklySeatUsageVerdict", () => {
  it("passes a plan under its limit, cached until the reading stops being evidence", () => {
    expect(
      weeklySeatUsageVerdict({
        alias: "plan-one",
        nowIso: NOW,
        snapshot: snapshot({ sevenDay: window({ utilization: 0.4 }) }),
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({
      alias: "plan-one",
      cacheWindow: {
        fromEpochSeconds: epochSeconds({ iso: NOW }),
        untilEpochSeconds: epochSeconds({ iso: "2026-11-05T12:50:00.000Z" }),
      },
      kind: "open",
      reason: "plan-one: under its usage limit of 50%",
    });
  });

  it.each([0.5, 0.73])("holds a plan whose week reads %j against a 50%% limit", (utilization) => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDay: window({ utilization }) }),
      usageLimitPercent: 50,
    });
    expect(verdict).toStrictEqual({
      alias: "plan-one",
      kind: "usage-limit",
      reason: `plan-one: seven_day at ${String(Math.round(utilization * 100))}%, at its usage limit of 50%`,
    });
  });

  it("holds at the limit even when the provider also refused the week, since the limit has no bypass", () => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDay: window({ status: "rejected", utilization: 0.6 }) }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("usage-limit");
  });

  it("lets a running seat carry on through a provider refusal below the limit", () => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDay: window({ status: "rejected", utilization: 0.2 }) }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("open");
  });

  // The gate reads no house bar at all, so an install whose routing bar sits below the limit (70% under an 80% limit,
  // a counterexample) can neither hold a seat early nor let it pass the limit.
  it.each<[number, "open" | "usage-limit"]>([
    [0.79, "open"],
    [0.8, "usage-limit"],
  ])("judges a week at %j against an 80%% limit on the limit alone: %s", (utilization, kind) => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDay: window({ utilization }) }),
      usageLimitPercent: 80,
    });
    expect(verdict.kind).toBe(kind);
  });

  it("holds a plan whose Fable week alone is at the limit", () => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDayFable: window({ resetAtIso: FABLE_RESET, utilization: 0.5 }) }),
      usageLimitPercent: 50,
    });
    expect(verdict).toStrictEqual({
      alias: "plan-one",
      kind: "usage-limit",
      reason: "plan-one: seven_day_fable at 50%, at its usage limit of 50%",
    });
  });

  it("holds a plan with no reading recorded as NOT MEASURED", () => {
    expect(
      weeklySeatUsageVerdict({
        alias: "plan-one",
        nowIso: NOW,
        snapshot: undefined,
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({ alias: "plan-one", kind: "not-measured", reason: "plan-one has no usage reading recorded" });
  });

  it("still passes a reading exactly an hour old, with an empty cache window the writer will not cache", () => {
    const observedAtIso = new Date(Date.parse(NOW) - CLAUDE_USAGE_READING_FRESH_MS).toISOString();
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ observedAtIso }),
      usageLimitPercent: 50,
    });
    expect(verdict).toStrictEqual({
      alias: "plan-one",
      cacheWindow: {
        fromEpochSeconds: epochSeconds({ iso: NOW }),
        untilEpochSeconds: epochSeconds({ iso: NOW }),
      },
      kind: "open",
      reason: "plan-one: under its usage limit of 50%",
    });
  });

  it("holds a reading one millisecond over an hour old as NOT MEASURED", () => {
    const observedAtIso = new Date(Date.parse(NOW) - CLAUDE_USAGE_READING_FRESH_MS - 1).toISOString();
    expect(
      weeklySeatUsageVerdict({
        alias: "plan-one",
        nowIso: NOW,
        snapshot: snapshot({ observedAtIso }),
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({
      alias: "plan-one",
      kind: "not-measured",
      reason: "plan-one: its usage reading from 2026-11-05T10:59:59.999Z is over an hour old",
    });
  });

  it("holds a reading dated after now as NOT MEASURED", () => {
    expect(
      weeklySeatUsageVerdict({
        alias: "plan-one",
        nowIso: NOW,
        snapshot: snapshot({ observedAtIso: "2026-11-05T12:00:01.000Z" }),
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({
      alias: "plan-one",
      kind: "not-measured",
      reason: "plan-one: its usage reading is dated 2026-11-05T12:00:01.000Z, after now",
    });
  });

  it.each([NOW, "2026-11-05T11:55:00.000Z"])(
    "no longer holds on a week that reset at %s, and caches nothing when every window has reset",
    (resetAtIso) => {
      expect(
        weeklySeatUsageVerdict({
          alias: "plan-one",
          nowIso: NOW,
          snapshot: snapshot({ sevenDay: window({ resetAtIso, utilization: 0.9 }) }),
          usageLimitPercent: 50,
        }),
      ).toStrictEqual({
        alias: "plan-one",
        kind: "open",
        reason: "plan-one: every recorded weekly window has reset since its reading",
      });
    },
  );

  it("skips the reset week and still holds on the Fable week that has not reset", () => {
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({
        sevenDay: window({ resetAtIso: NOW, utilization: 0.9 }),
        sevenDayFable: window({ resetAtIso: FABLE_RESET, utilization: 0.7 }),
      }),
      usageLimitPercent: 50,
    });
    expect(verdict.kind).toBe("usage-limit");
  });

  it("caches only until the earliest live reset when that comes before the reading goes stale", () => {
    const resetAtIso = "2026-11-05T12:20:00.000Z";
    const verdict = weeklySeatUsageVerdict({
      alias: "plan-one",
      nowIso: NOW,
      snapshot: snapshot({ sevenDayFable: window({ resetAtIso, utilization: 0.1 }) }),
      usageLimitPercent: 50,
    });
    expect(verdict).toStrictEqual({
      alias: "plan-one",
      cacheWindow: {
        fromEpochSeconds: epochSeconds({ iso: NOW }),
        untilEpochSeconds: epochSeconds({ iso: resetAtIso }),
      },
      kind: "open",
      reason: "plan-one: under its usage limit of 50%",
    });
  });

  it("never builds a wall for a plan at 100%, even with no reading", () => {
    expect(
      weeklySeatUsageVerdict({
        alias: "plan-one",
        nowIso: NOW,
        snapshot: undefined,
        usageLimitPercent: 100,
      }),
    ).toStrictEqual({ alias: "plan-one", kind: "open", reason: "plan-one has no usage limit" });
  });
});

/** A spend reading for plan-two observed ten minutes before now: 500.00 USD limit. */
function spend(over: Partial<ClaudeSpendReading>): ClaudeSpendReading {
  return {
    alias: "plan-two",
    currency: "USD",
    decimalPlaces: 2,
    isEnabled: true,
    monthlyLimitMinor: 50000,
    observedAtIso: OBSERVED,
    spendLimitReached: false,
    usedMinor: 10000,
    ...over,
  };
}

describe("monthlySeatUsageVerdict", () => {
  it("passes a plan under its limit, with no cache expiry", () => {
    expect(
      monthlySeatUsageVerdict({ alias: "plan-two", nowIso: NOW, reading: spend({}), usageLimitPercent: 50 }),
    ).toStrictEqual({
      alias: "plan-two",
      kind: "open",
      reason: "plan-two: 100.00 USD spent of 500.00 USD this month, usage limit 50% = 250.00 USD, 150.00 USD left",
    });
  });

  it("holds a plan at its limit", () => {
    expect(
      monthlySeatUsageVerdict({
        alias: "plan-two",
        nowIso: NOW,
        reading: spend({ usedMinor: 25000 }),
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({
      alias: "plan-two",
      kind: "usage-limit",
      reason: "plan-two: 250.00 USD spent of 500.00 USD this month, usage limit 50% = 250.00 USD, at its usage limit",
    });
  });

  it.each<[string, ClaudeSpendReading | undefined]>([
    ["no reading", undefined],
    ["a stale reading", spend({ observedAtIso: "2026-11-05T10:00:00.000Z" })],
    ["a future reading", spend({ observedAtIso: "2026-11-05T12:30:00.000Z" })],
    ["a reading with no limit", spend({ monthlyLimitMinor: null })],
  ])("holds %s as NOT MEASURED", (_label, reading) => {
    expect(monthlySeatUsageVerdict({ alias: "plan-two", nowIso: NOW, reading, usageLimitPercent: 50 }).kind).toBe(
      "not-measured",
    );
  });

  it("lets a running seat carry on when the provider disabled extra usage, which is the provider's wall", () => {
    expect(
      monthlySeatUsageVerdict({
        alias: "plan-two",
        nowIso: NOW,
        reading: spend({ isEnabled: false }),
        usageLimitPercent: 50,
      }),
    ).toStrictEqual({
      alias: "plan-two",
      kind: "open",
      reason: "plan-two: the provider reports extra usage disabled",
    });
  });

  it.each<[string, Partial<ClaudeSpendReading>]>([
    ["extra usage disabled", { isEnabled: false, usedMinor: 30000 }],
    ["its spend limit reached", { spendLimitReached: true, usedMinor: 30000 }],
  ])("still holds a plan over the owner's limit when the provider reports %s", (_label, over) => {
    expect(
      monthlySeatUsageVerdict({ alias: "plan-two", nowIso: NOW, reading: spend(over), usageLimitPercent: 50 }),
    ).toStrictEqual({
      alias: "plan-two",
      kind: "usage-limit",
      reason: "plan-two: 300.00 USD spent of 500.00 USD this month, usage limit 50% = 250.00 USD, at its usage limit",
    });
  });

  it("holds a provider-refused reading with no limit to measure against as NOT MEASURED", () => {
    expect(
      monthlySeatUsageVerdict({
        alias: "plan-two",
        nowIso: NOW,
        reading: spend({ isEnabled: false, monthlyLimitMinor: null }),
        usageLimitPercent: 50,
      }).kind,
    ).toBe("not-measured");
  });
});

describe("seatUsageHoldLines", () => {
  it("names the limit, says it is the recorded reading, offers the next step up and says there is no hatch", () => {
    expect(
      seatUsageHoldLines({
        allowance: { kind: "weekly-window" },
        usageLimitPercent: 50,
        verdict: {
          alias: "plan-one",
          kind: "usage-limit",
          reason: "plan-one: seven_day at 50%, at its usage limit of 50%",
        },
      }),
    ).toStrictEqual([
      "claude seat: USAGE LIMIT — this prompt is held because plan-one: seven_day at 50%, at its usage limit of 50%.",
      "This is judged relative to the last RECORDED reading, not live usage.",
      "It clears when the window resets, or when the owner raises the limit: " +
        "`slopweaver plans set-usage-limit --provider claude --plan plan-one --percent 60 --allowance weekly-window`.",
      "This hold has no escape hatch: the owner's usage limit is a ceiling nothing overrides.",
    ]);
  });

  it("sends a weekly plan with no reading to `claude gauge`", () => {
    expect(
      seatUsageHoldLines({
        allowance: { kind: "weekly-window" },
        usageLimitPercent: 30,
        verdict: seatUsageNotMeasured({ alias: "plan-one", reason: "plan-one has no usage reading recorded" }),
      }),
    ).toStrictEqual([
      "claude seat: NOT MEASURED — this prompt is held because plan-one has no usage reading recorded, and plan-one has a usage limit of 30%.",
      "This is judged relative to the last RECORDED reading, not live usage.",
      "Record a fresh reading with `slopweaver claude gauge --plan plan-one`, then send the prompt again.",
      "This hold has no escape hatch: the owner's usage limit is a ceiling nothing overrides.",
    ]);
  });

  it("sends a monthly-spend plan with no reading to `claude spend`, which gauge deliberately skips", () => {
    const lines = seatUsageHoldLines({
      allowance: { kind: "monthly-spend" },
      usageLimitPercent: 30,
      verdict: seatUsageNotMeasured({ alias: "plan-two", reason: "plan-two has no spend reading recorded" }),
    });
    expect(lines[2]).toBe(
      "Record a fresh reading with `slopweaver claude spend --plan plan-two`, then send the prompt again.",
    );
  });
});
