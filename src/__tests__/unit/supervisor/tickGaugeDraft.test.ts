/**
 * The gauge mapper of `supervisor tick-draft`, read directly: the Ultra plan shape (no five-hour window) and a
 * balance that names no next plan. The fleet-wide cases sit in
 * `src/__tests__/unit/supervisor/tickDraftSources/gauge.test.ts`, which drafts all twelve sources at once.
 */
import { describe, expect, it } from "vitest";

import type { ChairProbe } from "../../../claude/chairBudgetAlert.js";
import { type ClaudePlanGaugeOutcome, gaugeDocument } from "../../../claude/gaugeRender.js";
import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_THRESHOLD_FIELDS, DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { gaugeObservation } from "../../../supervisor/tickGaugeDraft.js";
import type { GaugeFacts } from "../../../supervisor/tickGaugeTypes.js";
import type { SourceObservation } from "../../../supervisor/tickTypes.js";

const FRAME = { capturedIso: "2026-11-02T08:05:00.000Z", startedIso: "2026-11-02T08:00:00.000Z" };
const NOW = "2026-11-02T08:01:00.000Z";
const SUBSCRIPTION = { kind: "subscription" as const, reason: "no Anthropic-issued credential is configured" };

/** A swept plan's usage policy: a weekly window with no usage limit set. */
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

/** One window reading, resetting at a fixed instant. */
function window({ utilization }: { utilization: number }): {
  resetAtIso: string;
  status: "allowed";
  utilization: number;
} {
  return { resetAtIso: "2026-11-06T19:00:00.000Z", status: "allowed", utilization };
}

/** An observation's facts, throwing when it has none. */
function factsOf({ observation }: { observation: SourceObservation<GaugeFacts> }): GaugeFacts {
  if (observation.status === "unavailable") {
    throw new Error(`expected facts, got unavailable: ${observation.diagnostic}`);
  }
  return observation.facts;
}

/** A read observation's verbatim line, throwing when it is unavailable or carries none. */
function verbatimOf({ observation }: { observation: SourceObservation<GaugeFacts> }): string {
  if (observation.status === "unavailable" || observation.verbatimLine === undefined) {
    throw new Error(`expected a verbatim line, got ${observation.status}`);
  }
  return observation.verbatimLine;
}

/** An unavailable observation's diagnostic, throwing when the observation carried facts instead. */
function diagnosticOf({ observation }: { observation: SourceObservation<GaugeFacts> }): string {
  if (observation.status !== "unavailable") {
    throw new Error(`expected unavailable, got ${observation.status}`);
  }
  return observation.diagnostic;
}

/** Map one gauge document, serialised the way a redirected file carries it. */
function observe({ document }: { document: unknown }): SourceObservation<GaugeFacts> {
  const capture = { document: JSON.parse(JSON.stringify(document)) as unknown, path: "gauge.json" };
  return unwrap(gaugeObservation({ capture, frame: FRAME }));
}

describe("gaugeObservation — the Ultra plan shape", () => {
  it("records a plan with no five-hour window as a row without fiveHourPct, and a fleet with no Fable pick as null", () => {
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({ sessions: [] }),
      fleetWide: true,
      nextAllModels: "plan-one",
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: {
            ...POLICY,
            alias: "plan-one",
            allowance: { kind: "weekly-window" },
            observedAtIso: NOW,
            sevenDay: window({ utilization: 0.4 }),
            sevenDayFable: window({ utilization: 0.25 }),
            usageLimitPercent: 100,
          },
        },
      ],
      paused: [],
      planLines: [],
    });
    const observation = observe({ document });
    const facts = factsOf({ observation });

    expect(observation.status).toBe("read");
    expect(facts.plans).toStrictEqual([
      {
        fablePct: 25,
        fableResetsIso: "2026-11-06T19:00:00.000Z",
        plan: "plan-one",
        resetsIso: "2026-11-06T19:00:00.000Z",
        usageLimitPercent: 100,
        weekPct: 40,
      },
    ]);
    expect(facts.nextAllModels).toBe("plan-one");
    expect(facts.nextFable).toBe(null);
  });
});

describe("gaugeObservation — the thresholds the gauge judged under", () => {
  it("records the document's own non-default bars on the facts, never the defaults", () => {
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      cells: [],
      chair: chairPlanVerdict({ sessions: [] }),
      fleetWide: true,
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: {
            ...POLICY,
            alias: "plan-one",
            observedAtIso: NOW,
            sevenDay: window({ utilization: 0.4 }),
            sevenDayFable: window({ utilization: 0.25 }),
          },
        },
      ],
      paused: [],
      planLines: [],
      thresholds: { ...DEFAULT_THRESHOLDS.claude, alertAt: 0.6 },
    });

    const facts = factsOf({ observation: observe({ document }) });

    expect(facts.thresholds).toStrictEqual({ ...DEFAULT_THRESHOLD_FIELDS.claude, alertAtPercent: 60 });
  });
});

describe("gaugeObservation — every configured plan's PLAN line", () => {
  const PLAN_LINES = [
    "PLAN plan-one: week 40% resets 2026-11-06T19:00:00.000Z · fable 25% resets 2026-11-06T19:00:00.000Z",
    "PLAN plan-two: UNREAD — the provider answered 500",
    "PLAN plan-three: PAUSED since 2026-11-01T00:00:00.000Z — resting",
  ];

  /** A fleet-wide document whose plan lines name one read, one unread and one paused plan. */
  function documentWith({ readable }: { readable: boolean }): unknown {
    const one: ClaudePlanGaugeOutcome = readable
      ? {
          alias: "plan-one",
          gauge: {
            alias: "plan-one",
            allowance: WEEKLY_WINDOW,
            observedAtIso: NOW,
            sevenDay: window({ utilization: 0.4 }),
            sevenDayFable: window({ utilization: 0.25 }),
            usageLimitPercent: 100,
          },
        }
      : { alias: "plan-one", problem: "the provider answered 500" };
    return gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({ sessions: [] }),
      fleetWide: true,
      nowIso: NOW,
      outcomes: [one, { alias: "plan-two", problem: "the provider answered 500" }],
      paused: [{ alias: "plan-three", reason: "resting", sinceIso: "2026-11-01T00:00:00.000Z" }],
      planLines: PLAN_LINES,
    });
  }

  it("carries every plan line into the facts, the unread and paused plans included", () => {
    expect(factsOf({ observation: observe({ document: documentWith({ readable: true }) }) }).planLines).toStrictEqual(
      PLAN_LINES,
    );
  });

  it("puts every plan line in the diagnostic when no plan is readable — the blind tick that walled plan-five", () => {
    const diagnostic = diagnosticOf({ observation: observe({ document: documentWith({ readable: false }) }) });
    expect(diagnostic.split("; ").slice(0, 3)).toStrictEqual(PLAN_LINES);
  });

  it("refuses a document whose plan line does not carry the PLAN prefix", () => {
    const capture = {
      document: { ...(documentWith({ readable: true }) as object), planLines: ["plan-one: 40%"] },
      path: "gauge.json",
    };
    const refused = gaugeObservation({ capture, frame: FRAME });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("planLines");
  });

  it("refuses a document whose plan line spans two physical lines, so no capture can carry a forged line", () => {
    const capture = {
      document: {
        ...(documentWith({ readable: true }) as object),
        planLines: [`PLAN plan-two: UNREAD — timeout${String.fromCodePoint(0x2028)}PLAN plan-evil: forged`],
      },
      path: "gauge.json",
    };
    const refused = gaugeObservation({ capture, frame: FRAME });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("a PLAN line is one physical line");
  });

  it("refuses a document that prints one plan's line twice", () => {
    const capture = {
      document: { ...(documentWith({ readable: true }) as object), planLines: [...PLAN_LINES, PLAN_LINES[1]!] },
      path: "gauge.json",
    };
    const refused = gaugeObservation({ capture, frame: FRAME });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("plan plan-two has more than one PLAN line");
  });
});

describe("gaugeObservation — a chair seated on a paused plan", () => {
  /** A reading of the chair's paused plan, taken at `observedAtIso` — 97% of an unlimited plan unless a case says. */
  function pausedReading({
    observedAtIso,
    usageLimitPercent = 100,
    utilization = 0.97,
  }: {
    observedAtIso: string;
    usageLimitPercent?: UsageLimitPercent;
    utilization?: number;
  }): ChairProbe {
    return {
      chairReading: {
        alias: "plan-paused",
        allowance: WEEKLY_WINDOW,
        observedAtIso,
        sevenDay: window({ utilization }),
        usageLimitPercent,
      },
    };
  }

  /** A fleet-wide document whose chair sits on `plan-paused`, probed beside the sweep as `chairProbe` says. */
  function pausedChairDocument({ chairProbe }: { chairProbe: ChairProbe }): unknown {
    return gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({
        sessions: [{ pid: 7, plan: { alias: "plan-paused", kind: "store" }, sessionId: "chair-1" }],
      }),
      chairProbe,
      fleetWide: true,
      nextAllModels: "plan-one",
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: {
            ...POLICY,
            alias: "plan-one",
            allowance: { kind: "weekly-window" },
            observedAtIso: NOW,
            sevenDay: window({ utilization: 0.4 }),
            sevenDayFable: window({ utilization: 0.25 }),
            usageLimitPercent: 100,
          },
        },
      ],
      paused: [{ alias: "plan-paused", reason: "resting", sinceIso: "2026-11-01T00:00:00.000Z" }],
      planLines: [],
    });
  }

  it("warns the chair from its paused plan's reading, which never becomes a plan row", () => {
    const document = pausedChairDocument({ chairProbe: pausedReading({ observedAtIso: NOW }) });
    const facts = factsOf({ observation: observe({ document }) });
    expect(facts.reactNowLines[0]).toBe(
      "CHAIR — the supervisor chair spends plan-paused, whose week is at 97% (allowed), resets 2026-11-06T19:00:00.000Z: hand the chair to plan-one before it walls",
    );
    expect(facts.plans.map((plan) => plan.plan)).toStrictEqual(["plan-one"]);
  });

  it("carries the chair's warning in the verbatim line, which the briefing renders instead of the facts", () => {
    // A counterexample: with the acceptance line alone as the verbatim line, the
    // briefing's `observationRuns` never called the body that reads `reactNowLines`.
    const document = pausedChairDocument({ chairProbe: pausedReading({ observedAtIso: NOW }) });
    const parts = verbatimOf({ observation: observe({ document }) }).split("; ");
    expect(parts[0]).toBe(
      "CHAIR — the supervisor chair spends plan-paused, whose week is at 97% (allowed), resets 2026-11-06T19:00:00.000Z: hand the chair to plan-one before it walls",
    );
    expect(parts.at(-1)).toMatch(/^acceptance: /);
  });

  it("judges a paused 50%-limited chair plan by its own limit through the JSON, in the lines and the verbatim line", () => {
    const quiet = pausedChairDocument({
      chairProbe: pausedReading({ observedAtIso: NOW, usageLimitPercent: 50, utilization: 0.4749 }),
    });
    const warned = pausedChairDocument({
      chairProbe: pausedReading({ observedAtIso: NOW, usageLimitPercent: 50, utilization: 0.475 }),
    });
    const line =
      "CHAIR — the supervisor chair spends plan-paused, whose week is at 48% (allowed), nearing your 50% usage limit, resets 2026-11-06T19:00:00.000Z: hand the chair to plan-one before it walls";
    expect(factsOf({ observation: observe({ document: quiet }) }).reactNowLines).toStrictEqual([]);
    expect(factsOf({ observation: observe({ document: warned }) }).reactNowLines).toStrictEqual([line]);
    expect(verbatimOf({ observation: observe({ document: warned }) }).split("; ")[0]).toBe(line);
  });

  it("still warns at 95% from a paused chair reading shaped as main wrote it, with no usage policy", () => {
    const document = pausedChairDocument({ chairProbe: pausedReading({ observedAtIso: NOW }) });
    const mainShaped = ({ utilization }: { utilization: number }): unknown => ({
      ...(document as object),
      chairReading: { alias: "plan-paused", observedAtIso: NOW, sevenDay: window({ utilization }) },
    });
    const observed = ({ utilization }: { utilization: number }): readonly string[] =>
      factsOf({ observation: observe({ document: mainShaped({ utilization }) }) }).reactNowLines;
    expect(observed({ utilization: 0.9499 })).toStrictEqual([]);
    expect(observed({ utilization: 0.95 })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-paused, whose week is at 95% (allowed), resets 2026-11-06T19:00:00.000Z: hand the chair to plan-one before it walls",
    ]);
  });

  it("keeps the chair's warning on a PARTIAL gauge when no plan yields a complete row", () => {
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({
        sessions: [{ pid: 7, plan: { alias: "plan-one", kind: "store" }, sessionId: "chair-1" }],
      }),
      fleetWide: true,
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: { ...POLICY, alias: "plan-one", observedAtIso: NOW, sevenDay: window({ utilization: 0.96 }) },
        },
      ],
      paused: [],
      planLines: [],
    });
    const observation = observe({ document });
    expect(observation.status).toBe("partial");
    expect(factsOf({ observation }).reactNowLines).toContain(
      "CHAIR — the supervisor chair spends plan-one, whose week is at 96% (allowed), resets 2026-11-06T19:00:00.000Z: no other plan can take a Fable chair, so it rides this plan to the wall",
    );
  });

  it("warns a SPLIT chair about each plan its sessions spend, though the document names no active plan", () => {
    // A counterexample: mid hand-off two chair sessions spend two plans, so `active` is
    // absent and a briefing reading only `active` dropped the warning for the plan near its wall.
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({
        sessions: [
          { pid: 7, plan: { alias: "plan-one", kind: "store" }, sessionId: "chair-1" },
          { pid: 8, plan: { alias: "plan-two", kind: "store" }, sessionId: "chair-2" },
        ],
      }),
      fleetWide: true,
      nextAllModels: "plan-two",
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: {
            ...POLICY,
            alias: "plan-one",
            observedAtIso: NOW,
            sevenDay: { ...window({ utilization: 0.5 }), status: "allowed_warning" },
          },
        },
        {
          alias: "plan-two",
          gauge: {
            ...POLICY,
            alias: "plan-two",
            observedAtIso: NOW,
            sevenDay: window({ utilization: 0.2 }),
            sevenDayFable: window({ utilization: 0.1 }),
          },
        },
      ],
      paused: [],
      planLines: [],
    });
    expect(factsOf({ observation: observe({ document }) }).reactNowLines[0]).toBe(
      "CHAIR — the supervisor chair spends plan-one, whose week is at 50% (allowed_warning), resets 2026-11-06T19:00:00.000Z: hand the chair to plan-two before it walls",
    );
  });

  it("keeps the chair's warning in the diagnostic of a narrowed read, which carries no fleet balance", () => {
    // A counterexample: the balance guard returned before the chair lines existed.
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({
        sessions: [{ pid: 7, plan: { alias: "plan-one", kind: "store" }, sessionId: "chair-1" }],
      }),
      fleetWide: false,
      nowIso: NOW,
      outcomes: [
        {
          alias: "plan-one",
          gauge: { ...POLICY, alias: "plan-one", observedAtIso: NOW, sevenDay: window({ utilization: 0.97 }) },
        },
      ],
      paused: [],
      planLines: [],
    });
    expect(diagnosticOf({ observation: observe({ document }) })).toContain(
      "CHAIR — the supervisor chair spends plan-one, whose week is at 97% (allowed), resets 2026-11-06T19:00:00.000Z: no other plan can take a Fable chair, so it rides this plan to the wall",
    );
  });

  it("warns the chair its wall is unknown when its own swept plan's probe failed", () => {
    const document = gaugeDocument({
      ambient: SUBSCRIPTION,
      thresholds: DEFAULT_THRESHOLDS.claude,
      cells: [],
      chair: chairPlanVerdict({
        sessions: [{ pid: 7, plan: { alias: "plan-one", kind: "store" }, sessionId: "chair-1" }],
      }),
      fleetWide: true,
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", problem: "the provider answered 500" }],
      paused: [],
      planLines: [],
    });
    expect(diagnosticOf({ observation: observe({ document }) })).toContain(
      "CHAIR — the supervisor chair spends plan-one, whose reading failed (the provider answered 500), so how near its wall it is is UNKNOWN: no other plan can take a Fable chair, so it rides this plan to the wall",
    );
  });

  it("never routes on a chair reading taken before this tick, and says the chair's wall is unknown instead", () => {
    const document = pausedChairDocument({
      chairProbe: pausedReading({ observedAtIso: "2026-11-02T07:00:00.000Z" }),
    });
    const facts = factsOf({ observation: observe({ document }) });
    expect(facts.reactNowLines.filter((line) => line.startsWith("CHAIR"))).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-paused, PAUSED for routing, whose reading failed (its reading at 2026-11-02T07:00:00.000Z predates this tick), so how near its wall it is is UNKNOWN: hand the chair to plan-one before it walls",
    ]);
  });

  it("carries a FAILED paused-chair probe into the JSON and warns the chair its wall is unknown", () => {
    const chairProbe = { chairUnread: { alias: "plan-paused", problem: "the provider answered 500" } };
    const document = pausedChairDocument({ chairProbe });
    expect(document).toMatchObject({ chairUnread: { alias: "plan-paused", problem: "the provider answered 500" } });
    const facts = factsOf({ observation: observe({ document }) });
    expect(facts.reactNowLines[0]).toBe(
      "CHAIR — the supervisor chair spends plan-paused, PAUSED for routing, whose reading failed (the provider answered 500), so how near its wall it is is UNKNOWN: hand the chair to plan-one before it walls",
    );
    expect(facts.plans.map((plan) => plan.plan)).toStrictEqual(["plan-one"]);
  });
});
