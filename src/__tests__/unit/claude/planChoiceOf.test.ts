import { afterEach, describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import {
  ambientClaudeChoice,
  pinnedClaudeChoice,
  routedClaudeChoice,
  spentReleaseClaudeChoice,
  unmeasuredClaudeChoice,
} from "../../../claude/planChoiceOf.js";
import type { ClaudeSpawnRoute } from "../../../claude/routeSpawn.js";
import { gateSpawnStore } from "../../../claude/spawnStore.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { planChoiceLine, type SessionPlanChoice } from "../../../sessions/planChoice.js";
import { routeSpawnToPlan, THRESHOLDS } from "./defaultThresholds.js";
import {
  cleanGateHome,
  makeGateHome,
  memoryGatePorts,
  oneHealthyDeps,
  SUBSCRIPTION,
  writeAccounts,
} from "./spawnStoreFixtures.js";

afterEach(cleanGateHome);

const OBSERVED = "2026-09-07T18:45:00.000Z";
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

const window = ({
  status = "allowed",
  utilization,
}: {
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso: "2026-09-13T22:00:00.000Z", status, utilization });

/** A plan whose plan-wide week the provider refuses, one with headroom, and one with more. */
const GAUGES: readonly ClaudePlanGauge[] = [
  {
    alias: "plan-a",
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ status: "rejected", utilization: 1 }),
    sevenDayFable: window({ utilization: 0.53 }),
  },
  {
    alias: "plan-b",
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ utilization: 0.5 }),
    sevenDayFable: window({ utilization: 0.4 }),
  },
  {
    alias: "plan-c",
    ...POLICY,
    observedAtIso: OBSERVED,
    sevenDay: window({ utilization: 0.04 }),
    sevenDayFable: window({ utilization: 0.02 }),
  },
];

type NamedChoice = Extract<SessionPlanChoice, { kind: "named" }>;

/** The named arm of a choice the case knows names a plan. */
const named = ({ choice }: { choice: SessionPlanChoice }): NamedChoice => {
  expect(choice.kind).toBe("named");
  return choice as NamedChoice;
};

/** The alias and state of each reading, in order. */
const states = ({ choice }: { choice: SessionPlanChoice }): readonly (readonly [string, string])[] =>
  named({ choice }).readings.map((reading) => [reading.alias, reading.state] as const);

/** The routed arm of a decision the case knows routed. */
const routed = ({ route }: { route: ClaudeSpawnRoute }): Extract<ClaudeSpawnRoute, { kind: "route" }> => {
  expect(route.kind).toBe("route");
  return route as Extract<ClaudeSpawnRoute, { kind: "route" }>;
};

describe("routedClaudeChoice", () => {
  it("records the winner, every other eligible plan, every excluded plan and every unreadable plan, each once", () => {
    const route = routed({ route: routeSpawnToPlan({ gauges: GAUGES, model: "fable" }) });
    const choice = routedClaudeChoice({ gauges: GAUGES, route, unreadable: ["plan-d"] });
    expect(states({ choice })).toStrictEqual([
      ["plan-c", "chosen"],
      ["plan-b", "eligible"],
      ["plan-a", "excluded"],
      ["plan-d", "unreadable"],
    ]);
    expect(choice).toStrictEqual({
      alias: "plan-c",
      basis: "routed",
      kind: "named",
      alternative: "--plan <alias>",
      readings: [
        { alias: "plan-c", observedAtIso: OBSERVED, reading: "fable-week 2%, all-models week 4%", state: "chosen" },
        { alias: "plan-b", observedAtIso: OBSERVED, reading: "fable-week 40%, all-models week 50%", state: "eligible" },
        {
          alias: "plan-a",
          observedAtIso: OBSERVED,
          reading: "provider-refused, fable-week 53%, all-models week 100%, eligible again 2026-09-13T22:00:00.000Z",
          state: "excluded",
        },
        { alias: "plan-d", reading: "no gauge was readable", state: "unreadable" },
      ],
      reason: "ranked first of 2 eligible plan(s) for a fable spawn",
      vendor: "claude",
    });
  });
});

describe("pinnedClaudeChoice", () => {
  it("records a standing pin on its own gauge, every other plan classified by the gate's own rule", () => {
    const choice = pinnedClaudeChoice({
      basis: "pinned",
      forced: false,
      gauge: GAUGES[1]!,
      gauges: GAUGES,
      model: "fable",
      thresholds: THRESHOLDS,
      unreadable: [],
    });
    expect(states({ choice })).toStrictEqual([
      ["plan-b", "chosen"],
      ["plan-a", "excluded"],
      ["plan-c", "eligible"],
    ]);
    const { alternative, basis, reason } = named({ choice });
    expect([basis, reason, alternative]).toStrictEqual([
      "pinned",
      "the seat is pinned to it; its own gauge allows it",
      "--plan <alias>",
    ]);
  });

  it("records a `--plan` seat as requested, with the alternative back to routing", () => {
    const choice = pinnedClaudeChoice({
      basis: "requested",
      forced: false,
      gauge: GAUGES[2]!,
      gauges: GAUGES,
      model: "fable",
      thresholds: THRESHOLDS,
      unreadable: ["plan-d"],
    });
    expect(planChoiceLine({ choice })).toBe(
      "plan: plan-c (claude, requested) — --plan named it; its own gauge allows it; readings: " +
        `plan-c chosen (fable-week 2%, all-models week 4%, read ${OBSERVED}), ` +
        "plan-a excluded (provider-refused, fable-week 53%, all-models week 100%, eligible again " +
        `2026-09-13T22:00:00.000Z, read ${OBSERVED}), ` +
        `plan-b eligible (fable-week 40%, all-models week 50%, read ${OBSERVED}), ` +
        "plan-d unreadable (no gauge was readable); " +
        "alternative: --plan <alias> names another plan; omit --plan to route on live gauges",
    );
  });

  it("records a spent pin the spent-plan hatch forced through as forced", () => {
    const choice = pinnedClaudeChoice({
      basis: "pinned",
      forced: true,
      gauge: GAUGES[0]!,
      gauges: GAUGES,
      model: "fable",
      thresholds: THRESHOLDS,
      unreadable: [],
    });
    expect(named({ choice }).reason).toBe(
      "the seat is pinned to it; booted past its spent gauge by the spent-plan hatch",
    );
    expect(states({ choice })).toStrictEqual([
      ["plan-a", "chosen"],
      ["plan-b", "eligible"],
      ["plan-c", "eligible"],
    ]);
  });
});

describe("spentReleaseClaudeChoice", () => {
  it("marks the released plan chosen among the exclusions, and still lists every other plan once", () => {
    const spent: readonly ClaudePlanGauge[] = GAUGES.map((gauge) => ({
      ...gauge,
      sevenDay: window({ status: "rejected", utilization: 1 }),
    }));
    const route = routeSpawnToPlan({ gauges: spent, model: "opus" });
    expect(route.kind).toBe("no-plan");
    const choice = spentReleaseClaudeChoice({ alias: "plan-a", gauges: spent, route, unreadable: ["plan-d"] });
    expect(states({ choice })).toStrictEqual([
      ["plan-a", "chosen"],
      ["plan-b", "excluded"],
      ["plan-c", "excluded"],
      ["plan-d", "unreadable"],
    ]);
  });
});

describe("unmeasuredClaudeChoice", () => {
  it("lists the chosen plan once even when it is among the unreadable", () => {
    const choice = unmeasuredClaudeChoice({
      alias: "plan-a",
      basis: "routed",
      others: [],
      unreadable: ["plan-a", "plan-b"],
    });
    expect(states({ choice })).toStrictEqual([
      ["plan-a", "chosen"],
      ["plan-b", "unreadable"],
    ]);
  });
});

describe("ambientClaudeChoice", () => {
  it("names the variable that outranks every store, and how to undo it", () => {
    expect(ambientClaudeChoice({ source: "apiKeyHelper" })).toStrictEqual({
      kind: "ambient",
      alternative: "unset apiKeyHelper to spend a plan login",
      reason: "apiKeyHelper outranks every credential store, so the session presents an API key and no plan decides",
      vendor: "claude",
    });
  });
});

describe("a recorded Claude choice never carries an account address or a store path", () => {
  it("leaves both out of the line and the JSON, though the register carried both", async () => {
    const dir = makeGateHome();
    const register = JSON.stringify([
      { alias: "plan-one", email: "seat-1@example.test", storeDir: "/stores/plan-one" },
      { alias: "plan-two", email: "seat-2@example.test", storeDir: "/stores/plan-two" },
    ]);
    writeAccounts({ dir, text: register });
    const gated = await gateSpawnStore({
      context: {
        ambient: SUBSCRIPTION,
        deps: oneHealthyDeps({ healthy: "plan-two" }),
        home: dir,
        ...memoryGatePorts(),
        unreadableHatchOpen: false,
      },
      force: false,
      model: undefined,
      pinnedStoreDir: undefined,
    });
    // The witness that the input carried what the output must not: the routed store itself is the path.
    expect(register).toContain("seat-1@example.test");
    expect(gated.storeDir).toBe("/stores/plan-two");
    const choice = gated.choice!;
    const line = planChoiceLine({ choice });
    const json = JSON.stringify(choice);
    expect(line).toBe(
      "plan: plan-two (claude, routed) — ranked first of 1 eligible plan(s) for a all-models spawn; readings: " +
        "plan-two chosen (all-models week 30%, 5h 20%, read 2026-09-12T06:00:00.000Z), " +
        "plan-one unreadable (no gauge was readable); alternative: --plan <alias>",
    );
    for (const leaked of ["seat-1@example.test", "seat-2@example.test", "/stores/", "example.test", "@"]) {
      expect(line).not.toContain(leaked);
      expect(json).not.toContain(leaked);
    }
  });
});
