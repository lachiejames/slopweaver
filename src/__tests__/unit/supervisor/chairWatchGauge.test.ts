/** The recorded-readings gauge `supervisor chair-watch` judges on (`src/supervisor/chairWatchGauge.ts`). */
import { describe, expect, it } from "vitest";

import { type ClaudeAccountGauge, claudePlanGauge } from "../../../claude/contracts.js";
import type { ClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshot.js";
import { nextSpawnTargets } from "../../../claude/routeSpawn.js";
import { claudeThresholdFieldsOf } from "../../../plans/thresholds.js";
import {
  CODEX_PLAN_NOT_READ,
  markChairReadings,
  type RecordedClaudeSnapshot,
  recordedChairGauge,
} from "../../../supervisor/chairWatchGauge.js";
import { PAUSED, registeredPlans } from "../../chairSuccessorFixture.js";

const NOW = "2026-11-27T12:00:00.000Z";

const REGISTER = registeredPlans({
  rows: [
    { alias: "plan-one", provider: "claude", storeDir: "/s/one" },
    { alias: "plan-two", provider: "claude", storeDir: "/s/two" },
    { alias: "codex-work", provider: "codex", storeDir: "/c/work" },
    { alias: "plan-off", paused: PAUSED, provider: "claude", storeDir: "/s/off" },
  ],
});

/**
 * A snapshot of one plan.
 *
 * @param alias the plan
 * @param observedAtIso when it was taken
 * @param week the seven-day fraction
 * @param fable the Fable week fraction, absent for a week-only reading
 * @param resetAtIso when both windows reset
 * @returns the recorded read of it
 */
function snap({
  alias,
  observedAtIso = "2026-11-27T11:30:00.000Z",
  week,
  fable,
  resetAtIso = "2026-12-01T00:00:00.000Z",
}: {
  alias: string;
  observedAtIso?: string;
  week: number;
  fable?: number;
  resetAtIso?: string;
}): RecordedClaudeSnapshot {
  const value: ClaudePlanUsageSnapshot = {
    alias,
    observedAtIso,
    sevenDay: { resetAtIso, status: "allowed", utilization: week },
    ...(fable === undefined ? {} : { sevenDayFable: { resetAtIso, status: "allowed", utilization: fable } }),
  };
  return { alias, read: { kind: "read", value } };
}

describe("recordedChairGauge", () => {
  it("judges two fresh readings, routing as nextSpawnTargets routes them", () => {
    const snapshots = [
      snap({ alias: "plan-one", fable: 0.5, week: 0.4 }),
      snap({ alias: "plan-two", fable: 0.1, week: 0.1 }),
    ];

    const built = recordedChairGauge({
      nowIso: NOW,
      plans: REGISTER.plans,
      snapshots,
      spends: [],
      thresholds: REGISTER.thresholds.claude,
    });

    const gauges = snapshots.map((one) => {
      const value = (one.read as { value: ClaudePlanUsageSnapshot }).value;
      const account: ClaudeAccountGauge = {
        alias: one.alias,
        observedAtIso: value.observedAtIso,
        sevenDay: value.sevenDay,
        sevenDayFable: value.sevenDayFable!,
      };
      return claudePlanGauge({ account: REGISTER.plans.find((plan) => plan.alias === one.alias)!, gauge: account });
    });
    const routed = nextSpawnTargets({ gauges, spends: [], thresholds: REGISTER.thresholds.claude });
    const fields = claudeThresholdFieldsOf({ thresholds: REGISTER.thresholds.claude });
    expect(routed.nextChair).toBe("plan-two");
    expect(routed.chairLevelWith).toStrictEqual([]);
    expect(built.gauge).toStrictEqual({
      chairLevelWith: [],
      kind: "read",
      nextChair: routed.nextChair,
      plans: [
        { fablePct: 50, plan: "plan-one", usageLimitPercent: gauges[0]!.usageLimitPercent, weekPct: 40 },
        { fablePct: 10, plan: "plan-two", usageLimitPercent: gauges[1]!.usageLimitPercent, weekPct: 10 },
      ],
      thresholds: {
        alertAtPercent: fields.alertAtPercent,
        driftingSpreadPercent: fields.driftingSpreadPercent,
        routeAtPercent: fields.routeAtPercent,
      },
      weekOnly: [],
    });
    expect(built.readings).toStrictEqual([
      {
        alias: "plan-one",
        chair: false,
        observedAtIso: "2026-11-27T11:30:00.000Z",
        reading: "week 40%, Fable week 50%",
        state: "measured",
        vendor: "claude",
      },
      {
        alias: "plan-two",
        chair: false,
        observedAtIso: "2026-11-27T11:30:00.000Z",
        reading: "week 10%, Fable week 10%",
        state: "measured",
        vendor: "claude",
      },
      { alias: "codex-work", chair: false, reading: CODEX_PLAN_NOT_READ, state: "not-measured", vendor: "codex" },
      {
        alias: "plan-off",
        chair: false,
        reading: "paused since 2026-11-01T00:00:00.000Z",
        state: "not-measured",
        vendor: "claude",
      },
    ]);
  });

  it("keeps a stale reading as a reading but never judges on it, naming it in the gap", () => {
    const built = recordedChairGauge({
      nowIso: NOW,
      plans: REGISTER.plans,
      snapshots: [
        snap({ alias: "plan-one", fable: 0.5, week: 0.4 }),
        snap({ alias: "plan-two", fable: 0.1, observedAtIso: "2026-11-27T09:00:00.000Z", week: 0.1 }),
      ],
      spends: [],
      thresholds: REGISTER.thresholds.claude,
    });

    expect(built.readings[1]).toStrictEqual({
      alias: "plan-two",
      chair: false,
      observedAtIso: "2026-11-27T09:00:00.000Z",
      reading: "week 10%, Fable week 10% at 2026-11-27T09:00:00.000Z",
      state: "stale",
      vendor: "claude",
    });
    expect(built.gauge.kind).toBe("read");
    const gauge = built.gauge as Extract<typeof built.gauge, { kind: "read" }>;
    expect(gauge.plans.map((row) => row.plan)).toStrictEqual(["plan-one"]);
    expect(gauge.gap).toBe(
      "plan-two's last reading, at 2026-11-27T09:00:00.000Z, is older than the hour a reading stays evidence",
    );
  });

  it("names a plan with no recorded reading in the gap", () => {
    const built = recordedChairGauge({
      nowIso: NOW,
      plans: REGISTER.plans,
      snapshots: [
        snap({ alias: "plan-one", week: 0.4 }),
        { alias: "plan-two", read: { kind: "read", value: undefined } },
      ],
      spends: [],
      thresholds: REGISTER.thresholds.claude,
    });

    expect(built.readings[1]).toStrictEqual({
      alias: "plan-two",
      chair: false,
      reading: "no reading recorded",
      state: "none",
      vendor: "claude",
    });
    const gauge = built.gauge as Extract<typeof built.gauge, { kind: "read" }>;
    expect(gauge.gap).toBe("plan-two has no recorded reading");
    expect(gauge.plans).toStrictEqual([]);
    expect(gauge.weekOnly!.map((row) => row.plan)).toStrictEqual(["plan-one"]);
  });

  it("reads a fresh snapshot whose window has since reset as no reading at all", () => {
    const built = recordedChairGauge({
      nowIso: NOW,
      plans: REGISTER.plans,
      snapshots: [
        snap({ alias: "plan-one", fable: 0.9, resetAtIso: "2026-11-27T11:45:00.000Z", week: 0.9 }),
        snap({ alias: "plan-two", fable: 0.1, week: 0.1 }),
      ],
      spends: [],
      thresholds: REGISTER.thresholds.claude,
    });

    expect(built.readings[0]).toStrictEqual({
      alias: "plan-one",
      chair: false,
      observedAtIso: "2026-11-27T11:30:00.000Z",
      reading: "window reset at 2026-11-27T11:45:00.000Z, after the last reading",
      state: "none",
      vendor: "claude",
    });
    const gauge = built.gauge as Extract<typeof built.gauge, { kind: "read" }>;
    expect(gauge.gap).toBe("plan-one's window reset at 2026-11-27T11:45:00.000Z, after its last reading");
    expect(gauge.plans.map((row) => row.plan)).toStrictEqual(["plan-two"]);
  });

  it("is unmeasured when no plan has a fresh reading, naming every gap", () => {
    const built = recordedChairGauge({
      nowIso: NOW,
      plans: REGISTER.plans,
      snapshots: [
        snap({ alias: "plan-one", observedAtIso: "2026-11-26T12:00:00.000Z", week: 0.4 }),
        { alias: "plan-two", read: { kind: "unreadable", reason: "EACCES on /home/secret/plan-two.json" } },
      ],
      spends: [],
      thresholds: REGISTER.thresholds.claude,
    });

    expect(built.gauge).toStrictEqual({
      kind: "unmeasured",
      why: "no Claude plan has a fresh recorded reading — plan-one's last reading, at 2026-11-26T12:00:00.000Z, is older than the hour a reading stays evidence; plan-two's recorded reading could not be read",
    });
    expect(JSON.stringify(built)).not.toContain("/home/secret");
  });

  it("is unmeasured on a register with no Claude plan to read", () => {
    const codexOnly = registeredPlans({ rows: [{ alias: "codex-work", provider: "codex", storeDir: "/c/work" }] });

    const built = recordedChairGauge({
      nowIso: NOW,
      plans: codexOnly.plans,
      snapshots: [],
      spends: [],
      thresholds: codexOnly.thresholds.claude,
    });

    expect(built.gauge).toStrictEqual({
      kind: "unmeasured",
      why: "no Claude plan has a fresh recorded reading — no Claude plan is registered to read",
    });
  });
});

describe("markChairReadings", () => {
  it("flags the Claude plans a chair session spends, and never a Codex plan of the same alias", () => {
    const marked = markChairReadings({
      chairPlans: ["plan-one", "codex-work"],
      readings: [
        { alias: "plan-one", chair: false, reading: "week 40%", state: "measured", vendor: "claude" },
        { alias: "plan-two", chair: false, reading: "week 10%", state: "measured", vendor: "claude" },
        { alias: "codex-work", chair: false, reading: CODEX_PLAN_NOT_READ, state: "not-measured", vendor: "codex" },
      ],
    });

    expect(marked.map((reading) => reading.chair)).toStrictEqual([true, false, false]);
  });
});
