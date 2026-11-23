/**
 * The per-plan usage snapshot's contract: what one reading records, and the strict parse that refuses anything that
 * is not exactly a snapshot of the plan its file is named for.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import { parseClaudePlanUsageSnapshot, planUsageSnapshot, snapshotAlias } from "../../../claude/planUsageSnapshot.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PATH = "/tmp/sw-home/live/claude-usage/plan-one.json";
const WEEK = { resetAtIso: "2026-11-08T12:00:00.000Z", status: "allowed", utilization: 0.42 } as const;
const FABLE = { resetAtIso: "2026-11-07T12:00:00.000Z", status: "allowed_warning", utilization: 0.81 } as const;

describe("planUsageSnapshot", () => {
  it("keeps the two weekly windows and the instant, and drops the five-hour window", () => {
    const gauge: ClaudeAccountGauge = {
      alias: "plan-one",
      fiveHour: { resetAtIso: "2026-11-05T15:00:00.000Z", status: "rejected", utilization: 1 },
      observedAtIso: "2026-11-05T11:50:00.000Z",
      representativeClaim: "seven_day",
      sevenDay: WEEK,
      sevenDayFable: FABLE,
    };
    expect(planUsageSnapshot({ gauge })).toStrictEqual({
      alias: "plan-one",
      observedAtIso: "2026-11-05T11:50:00.000Z",
      sevenDay: WEEK,
      sevenDayFable: FABLE,
    });
  });

  it("leaves an unread Fable window absent, never an empty one", () => {
    const gauge: ClaudeAccountGauge = { alias: "plan-one", observedAtIso: "2026-11-05T11:50:00.000Z", sevenDay: WEEK };
    expect(Object.keys(planUsageSnapshot({ gauge }))).toStrictEqual(["alias", "observedAtIso", "sevenDay"]);
  });
});

describe("parseClaudePlanUsageSnapshot", () => {
  const document = {
    alias: "plan-one",
    observedAtIso: "2026-11-05T11:50:00.000Z",
    sevenDay: WEEK,
    sevenDayFable: FABLE,
  };

  it("round-trips an exact snapshot", () => {
    expect(unwrap(parseClaudePlanUsageSnapshot({ document, expectedAlias: "plan-one", path: PATH }))).toStrictEqual(
      document,
    );
  });

  it("reads a snapshot with no Fable window as one without the key", () => {
    const { sevenDayFable: _dropped, ...weekOnly } = document;
    const parsed = unwrap(parseClaudePlanUsageSnapshot({ document: weekOnly, expectedAlias: "plan-one", path: PATH }));
    expect(Object.keys(parsed)).toStrictEqual(["alias", "observedAtIso", "sevenDay"]);
  });

  it("refuses a snapshot naming another plan, so a copied file never judges the wrong plan", () => {
    const error = unwrapErr(parseClaudePlanUsageSnapshot({ document, expectedAlias: "plan-two", path: PATH }));
    expect(error.code).toBe("PLAN_USAGE_SNAPSHOT_UNREADABLE");
    expect(error.message).toBe(
      `the usage snapshot at ${PATH} could not be read: it names plan "plan-one", not "plan-two"`,
    );
  });

  it.each<[string, unknown]>([
    ["an unknown field", { ...document, extra: 1 }],
    ["an unparseable observation", { ...document, observedAtIso: "yesterday" }],
    ["an unparseable reset", { ...document, sevenDay: { ...WEEK, resetAtIso: "soon" } }],
    ["a negative utilization", { ...document, sevenDay: { ...WEEK, utilization: -0.1 } }],
    ["an infinite utilization", { ...document, sevenDay: { ...WEEK, utilization: Number.POSITIVE_INFINITY } }],
    ["a NaN utilization", { ...document, sevenDay: { ...WEEK, utilization: Number.NaN } }],
    ["an unknown status", { ...document, sevenDay: { ...WEEK, status: "throttled" } }],
    ["a missing week", { alias: "plan-one", observedAtIso: "2026-11-05T11:50:00.000Z" }],
  ])("refuses %s as unreadable", (_label, candidate) => {
    expect(
      unwrapErr(parseClaudePlanUsageSnapshot({ document: candidate, expectedAlias: "plan-one", path: PATH })).code,
    ).toBe("PLAN_USAGE_SNAPSHOT_UNREADABLE");
  });
});

describe("snapshotAlias", () => {
  it("accepts a register alias", () => {
    expect(unwrap(snapshotAlias({ alias: "plan-one" }))).toBe("plan-one");
  });

  it.each(["../plan-one", "plan/one", "Plan-One", "", "a".repeat(33)])(
    "refuses %j, which could leave the snapshot directory or is no register alias",
    (alias) => {
      expect(unwrapErr(snapshotAlias({ alias })).code).toBe("PLAN_USAGE_ALIAS_INVALID");
    },
  );
});
