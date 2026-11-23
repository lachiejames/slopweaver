import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import {
  classifyModel,
  renderPolicyRefusal,
  renderSpawnRefusal,
  renderSpawnRoute,
} from "../../../claude/routeSpawn.js";
import { MONTHLY_GAUGE_NOT_ITS_ALLOWANCE } from "../../../claude/select.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { routeSpawnToPlan, spawnBlockedBy } from "./defaultThresholds.js";

const OBSERVED = "2026-09-07T18:45:00.000Z";

/** A weekly-window plan with no usage limit set — every fixture's policy unless a case says otherwise. */
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

/**
 * One window at a utilization, `allowed` unless the caller says otherwise.
 *
 * @param utilization the fraction spent
 * @param status how the provider grades it
 * @param resetAtIso when it resets
 * @returns the reading
 */
const window = ({
  resetAtIso = "2026-09-13T22:00:00.000Z",
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status, utilization });

/**
 * The three plans exactly as the owner screenshotted them — the incident this
 * router exists to answer. Plan A's plan-wide week is spent while its Fable week is not; plan B's Fable week
 * is spent while its plan-wide week is not; plan C is untouched.
 */
const INCIDENT: readonly ClaudePlanGauge[] = [
  {
    alias: "plan-a",
    fiveHour: window({ utilization: 0.81 }),
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ resetAtIso: "2026-09-13T22:00:00.000Z", status: "rejected", utilization: 1 }),
    sevenDayFable: window({ resetAtIso: "2026-09-13T22:00:00.000Z", utilization: 0.53 }),
  },
  {
    alias: "plan-b",
    fiveHour: window({ utilization: 0 }),
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ resetAtIso: "2026-09-11T19:00:00.000Z", utilization: 0.67 }),
    sevenDayFable: window({ resetAtIso: "2026-09-11T19:00:00.000Z", status: "rejected", utilization: 1 }),
  },
  {
    alias: "plan-c",
    fiveHour: window({ utilization: 0 }),
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ resetAtIso: "2026-09-12T07:00:00.000Z", utilization: 0.04 }),
    sevenDayFable: window({ resetAtIso: "2026-09-12T07:00:00.000Z", utilization: 0.02 }),
  },
];

describe("classifyModel", () => {
  it("reads the bare tier alias the spawn verb is usually given", () => {
    expect(classifyModel({ model: "fable" })).toBe("fable");
    expect(classifyModel({ model: "opus" })).toBe("all-models");
    expect(classifyModel({ model: "sonnet" })).toBe("all-models");
  });

  it("reads a versioned Fable id, so a point release does not reclassify a Fable spawn", () => {
    expect(classifyModel({ model: "claude-fable-5-1" })).toBe("fable");
    expect(classifyModel({ model: "  Claude-Fable-6  " })).toBe("fable");
  });

  it("calls Haiku all-models, because it spends the plan-wide week and nothing else", () => {
    expect(classifyModel({ model: "claude-haiku-4-5-20251001" })).toBe("all-models");
  });
});

describe("routeSpawnToPlan over the incident", () => {
  it("sends a Fable spawn to the untouched plan, never to the one whose Fable week is spent", () => {
    const route = routeSpawnToPlan({ gauges: INCIDENT, model: "fable" });
    expect(route.kind).toBe("route");
    expect(route.kind === "route" && route.to).toBe("plan-c");
    expect(route.excluded.map((exclusion) => `${exclusion.alias}:${exclusion.reason}`)).toStrictEqual([
      "plan-a:seven_day refused",
      "plan-b:seven_day_fable refused",
    ]);
  });

  it("sends an Opus spawn to the untouched plan and passes over ONLY the plan-wide-spent one", () => {
    const route = routeSpawnToPlan({ gauges: INCIDENT, model: "opus" });
    expect(route.kind === "route" && route.to).toBe("plan-c");
    expect(route.excluded.map((exclusion) => exclusion.alias)).toStrictEqual(["plan-a"]);
  });

  it("keeps a plan whose FABLE week is spent as a home for ordinary work", () => {
    const route = routeSpawnToPlan({ gauges: [INCIDENT[1]!], model: "sonnet" });
    expect(route.kind === "route" && route.to).toBe("plan-b");
  });

  it("never routes a Fable spawn onto Fable headroom the plan-wide window makes unspendable", () => {
    const route = routeSpawnToPlan({ gauges: [INCIDENT[0]!], model: "fable" });
    expect(route.kind).toBe("no-plan");
    expect(route.kind === "no-plan" && route.earliestResetIso).toBe("2026-09-13T22:00:00.000Z");
  });
});

describe("routeSpawnToPlan ranking", () => {
  const roomy = ({ alias, fable, week }: { alias: string; fable: number; week: number }): ClaudePlanGauge => ({
    alias,
    fiveHour: window({ utilization: 0.1 }),
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ utilization: week }),
    sevenDayFable: window({ utilization: fable }),
  });

  it("ranks a Fable spawn on the FABLE week, even when another plan has more plan-wide room", () => {
    const route = routeSpawnToPlan({
      gauges: [
        roomy({ alias: "low-fable", fable: 0.7, week: 0.05 }),
        roomy({ alias: "high-fable", fable: 0.1, week: 0.6 }),
      ],
      model: "fable",
    });
    expect(route.kind === "route" && route.to).toBe("high-fable");
  });

  it("ranks an all-models spawn on the plan-wide week, ignoring the Fable one entirely", () => {
    const route = routeSpawnToPlan({
      gauges: [
        roomy({ alias: "low-fable", fable: 0.7, week: 0.05 }),
        roomy({ alias: "high-fable", fable: 0.1, week: 0.6 }),
      ],
      model: "opus",
    });
    expect(route.kind === "route" && route.to).toBe("low-fable");
  });

  it("DEFERS a Fable-unmeasured plan behind a measured one rather than ranking its plan-wide week against a Fable week", () => {
    // Behaviour change, approved by the owner. The previous ranker fell back to `sevenDay` for
    // a gauge with no Fable reading and then compared that 2% plan-wide week against the other plan's 30%
    // FABLE week — two different windows on one scale — so an unread plan won every Fable spawn by being
    // unread. Absent is NOT MEASURED, so it now sorts behind everything that was measured.
    const unmeasured: ClaudePlanGauge = {
      alias: "unmeasured",
      fiveHour: window({ utilization: 0.1 }),
      ...POLICY,
      observedAtIso: OBSERVED,
      sevenDay: window({ utilization: 0.02 }),
    };
    const route = routeSpawnToPlan({
      gauges: [roomy({ alias: "measured", fable: 0.3, week: 0.6 }), unmeasured],
      model: "fable",
    });
    expect(route.kind === "route" && route.to).toBe("measured");
  });

  it("reports no plan and the earliest reset when every plan is barred", () => {
    const route = routeSpawnToPlan({ gauges: [], model: "opus" });
    expect(route.kind).toBe("no-plan");
    expect(route.kind === "no-plan" && route.earliestResetIso).toBe(undefined);
  });

  it("excludes a plan at the rotation threshold before the provider ever refuses it", () => {
    const near = roomy({ alias: "near", fable: 0.1, week: 0.95 });
    const route = routeSpawnToPlan({ gauges: [near], model: "opus" });
    expect(route.kind).toBe("no-plan");
    expect(route.excluded[0]!.reason).toBe("seven_day at 95%");
  });

  it("routes onto a plan at 90 percent, which the 0.85 cap refused", () => {
    const deep = roomy({ alias: "deep", fable: 0.1, week: 0.9 });
    const route = routeSpawnToPlan({ gauges: [deep], model: "opus" });
    expect(route.kind).toBe("route");
    expect(route.excluded).toEqual([]);
    expect(renderSpawnRoute({ route })).toContain("deep");
  });
});

describe("renderSpawnRoute", () => {
  it("names the plan, the window it was ranked on, the reading's instant, and what it passed over", () => {
    const route = routeSpawnToPlan({ gauges: INCIDENT, model: "fable" });
    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: plan-c for a fable spawn — fable-week 2%, all-models week 4%, 5h 0%, read 2026-09-07T18:45:00.000Z; " +
        "passed over plan-a seven_day refused, plan-b seven_day_fable refused",
    );
  });

  it("routes to the monthly lane only once every weekly plan is barred, naming its spend and what it passed over", () => {
    const route = routeSpawnToPlan({
      gauges: [INCIDENT[0]!],
      model: "opus",
      spends: [
        { alias: "plan-d", verdict: { kind: "not-measured", reason: "no spend reading recorded" } },
        {
          alias: "plan-e",
          verdict: { currency: "USD", headroomMinor: 6000, kind: "open", reason: "$40 of $100", usedFraction: 0.4 },
        },
      ],
    });
    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: plan-e for a all-models spawn — monthly spend: $40 of $100; passed over plan-a seven_day " +
        "refused, plan-d monthly spend: no spend reading recorded",
    );
  });

  it("says when the fleet comes back rather than only that it is down", () => {
    const route = routeSpawnToPlan({ gauges: [INCIDENT[0]!], model: "fable" });
    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: NO plan can take a fable spawn — back 2026-09-13T22:00:00.000Z; passed over plan-a seven_day refused",
    );
  });
});

describe("a spawn that pinned no model", () => {
  it("is all-models, because the one Fable seat is pinned and never reaches this router", () => {
    expect(classifyModel({ model: undefined })).toBe("all-models");
    const route = routeSpawnToPlan({ gauges: INCIDENT, model: undefined });
    expect(route.kind === "route" && route.modelClass).toBe("all-models");
  });
});

describe("spawnBlockedBy", () => {
  it("bars a plan whose plan-wide week the provider has already refused", () => {
    const blocked = spawnBlockedBy({ gauge: INCIDENT[0]!, model: "opus" });
    expect(blocked!.alias).toBe("plan-a");
    expect(blocked!.reason).toBe("seven_day refused");
    expect(blocked!.eligibleAtIso).toBe("2026-09-13T22:00:00.000Z");
  });

  it("lets an all-models spawn onto a plan whose FABLE week is spent, because it will not spend it", () => {
    expect(spawnBlockedBy({ gauge: INCIDENT[1]!, model: "opus" })).toBe(undefined);
    expect(spawnBlockedBy({ gauge: INCIDENT[1]!, model: "fable" })!.reason).toBe("seven_day_fable refused");
  });

  it("is the same rule the router excludes on, asked of one already-chosen plan", () => {
    const route = routeSpawnToPlan({ gauges: INCIDENT, model: "fable" });
    expect(route.excluded.map((exclusion) => exclusion.alias)).toStrictEqual(["plan-a", "plan-b"]);
    expect(spawnBlockedBy({ gauge: INCIDENT[2]!, model: "fable" })).toBe(undefined);
  });

  it("bars a plan at the usage limit set on it, as a usage limit", () => {
    const limited: ClaudePlanGauge = { ...INCIDENT[2]!, usageLimitPercent: 10, sevenDay: window({ utilization: 0.1 }) };
    expect(spawnBlockedBy({ gauge: limited, model: "opus" })).toStrictEqual({
      alias: "plan-c",
      eligibleAtIso: "2026-09-13T22:00:00.000Z",
      kind: "usage-limit",
      reason: "seven_day at 10%, at its usage limit of 10%",
    });
  });

  it("bars a monthly-spend plan's gauge, since its windows are not its allowance", () => {
    const monthly: ClaudePlanGauge = { ...INCIDENT[2]!, allowance: { kind: "monthly-spend" } };
    expect(spawnBlockedBy({ gauge: monthly, model: "opus" })).toStrictEqual({
      alias: "plan-c",
      kind: "not-measured",
      reason: MONTHLY_GAUGE_NOT_ITS_ALLOWANCE,
    });
  });
});

describe("renderPolicyRefusal", () => {
  it("names the limit, refuses any override, and gives the verb that raises it", () => {
    expect(
      renderPolicyRefusal({
        alias: "plan-c",
        allowance: "weekly-window",
        kind: "usage-limit",
        limit: "plan-c is at its limit",
      }),
    ).toBe(
      "plan-c is at its limit — REFUSING. This is the owner's own policy on the plan, so no `--force` and no " +
        "escape hatch crosses it; to change it, raise it with `slopweaver plans set-usage-limit --provider claude " +
        "--plan plan-c --percent <N> --allowance weekly-window`.",
    );
  });

  it("tells a monthly-spend plan at its limit to raise its monthly limit, never its weekly one", () => {
    expect(
      renderPolicyRefusal({
        alias: "plan-c",
        allowance: "monthly-spend",
        kind: "usage-limit",
        limit: "plan-c is at its limit",
      }),
    ).toBe(
      "plan-c is at its limit — REFUSING. This is the owner's own policy on the plan, so no `--force` and no " +
        "escape hatch crosses it; to change it, raise it with `slopweaver plans set-usage-limit --provider claude " +
        "--plan plan-c --percent <N> --allowance monthly-spend`.",
    );
  });

  it("tells a monthly-spend plan with no fresh reading to record one, the hour it stays evidence named", () => {
    expect(
      renderPolicyRefusal({
        alias: "plan-c",
        allowance: "monthly-spend",
        kind: "not-measured",
        limit: "plan-c has no spend reading",
      }),
    ).toBe(
      "plan-c has no spend reading — REFUSING. This is the owner's own policy on the plan, so no `--force` and no " +
        "escape hatch crosses it; to change it, record a fresh spend reading with `slopweaver claude spend --plan " +
        "plan-c` (it is evidence for one hour).",
    );
  });
});

describe("renderSpawnRefusal", () => {
  it("names the limit, the environment variable that overrides it, and the plans that still have room", () => {
    expect(
      renderSpawnRefusal({
        eligible: [INCIDENT[2]!],
        escapeHatchEnv: "SLOPWEAVER_ALLOW_SPENT_PLAN",
        limit: "claude routing: the pinned seat plan-a has seven_day refused — back 2026-09-13T22:00:00.000Z",
      }),
    ).toBe(
      "claude routing: the pinned seat plan-a has seven_day refused — back 2026-09-13T22:00:00.000Z — " +
        "REFUSING rather than booting into a wall. To override, run the same command again with " +
        "SLOPWEAVER_ALLOW_SPENT_PLAN=1; otherwise use one of the other plans: plan-c (week 4%).",
    );
  });

  it("says so plainly when there is nowhere else to send the spawn", () => {
    expect(
      renderSpawnRefusal({ eligible: [], escapeHatchEnv: "SLOPWEAVER_ALLOW_SPENT_PLAN", limit: "everything is spent" }),
    ).toBe(
      "everything is spent — REFUSING rather than booting into a wall. To override, run the same command " +
        "again with SLOPWEAVER_ALLOW_SPENT_PLAN=1; no other configured plan has headroom either.",
    );
  });
});
