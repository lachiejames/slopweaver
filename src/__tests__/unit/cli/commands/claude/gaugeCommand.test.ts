import { describe, expect, it } from "vitest";

import type { ClaudeAmbientCredential } from "../../../../../claude/ambientCredential.js";
import type { ClaudePlanGauge } from "../../../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../../../claude/errors.js";
import { gaugeDocument } from "../../../../../claude/gaugeRender.js";
import { chairPlanVerdict } from "../../../../../claude/seatBoot.js";
import { claudeGaugeCommand } from "../../../../../cli/commands/claude/run.js";
import { parseFlags } from "../../../../../cli/parseFlags.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";

/** The gauge document under the default thresholds, which every case not about a threshold is judged by. */
const documentOf = (args: Omit<Parameters<typeof gaugeDocument>[0], "thresholds">): ReturnType<typeof gaugeDocument> =>
  gaugeDocument({ ...args, thresholds: DEFAULT_THRESHOLDS.claude });

/** A chair the fixture never read — a gauge document must carry one either way. */
const NO_CHAIR = chairPlanVerdict({ sessions: [] });

const NOW = "2026-09-04T08:20:00.000Z";

const UNSHADOWED: ClaudeAmbientCredential = {
  kind: "subscription",
  reason: "no Anthropic-issued credential is configured, so a session presents its store's own plan login",
};

function gauge({ alias }: { alias: string }): ClaudePlanGauge {
  return {
    alias,
    allowance: { kind: "weekly-window" },
    fiveHour: { resetAtIso: "2026-09-04T09:00:00.000Z", status: "allowed", utilization: 0.43 },
    observedAtIso: NOW,
    sevenDay: { resetAtIso: "2026-09-05T22:00:00.000Z", status: "allowed", utilization: 0.66 },
    usageLimitPercent: 100,
  };
}

describe("claudeGaugeCommand", () => {
  it("takes the one argv parameter the CLI verb contract dispatches with", () => {
    expect(claudeGaugeCommand.length).toBe(1);
  });
});

describe("gauge flag parsing", () => {
  /** The verb's own spec and offset, restated here so a drift between them and the verb fails a test. */
  const SPEC = { boolean: ["json"], string: ["plan"] };
  const TAIL = ["node", "cli", "claude", "gauge"];

  it("REFUSES a trailing --plan rather than silently sweeping the whole fleet", () => {
    const parsed = parseFlags({ args: [...TAIL, "--plan"].slice(4), spec: SPEC });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join("; ")).toContain("--plan requires a value");
  });

  it("refuses an unknown flag", () => {
    const parsed = parseFlags({ args: ["--bogus"], spec: SPEC });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join("; ")).toContain("unknown flag: --bogus");
  });

  it("reads an alias off --plan", () => {
    const parsed = parseFlags({ args: ["--plan", "plan-one"], spec: SPEC });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values["plan"]).toBe("plan-one");
  });

  it("leaves the alias absent when no --plan was given, which is the fleet sweep", () => {
    const parsed = parseFlags({ args: ["--json"], spec: SPEC });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values["plan"]).toBeUndefined();
    expect(unwrap(parsed).values["json"]).toBe(true);
  });
});

describe("gaugeDocument", () => {
  it("carries every plan's rendered account and the trust behind it, never omitting either key", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      ambient: UNSHADOWED,
      cells: [
        { alias: "plan-one", cell: { address: "admin@example.invalid", trust: "bound" } },
        { alias: "plan-two", cell: { trust: "unmapped" } },
      ],
      fleetWide: true,
      nowIso: NOW,
      outcomes: [
        { alias: "plan-one", gauge: gauge({ alias: "plan-one" }) },
        { alias: "plan-two", gauge: gauge({ alias: "plan-two" }) },
      ],
    });
    expect(doc.plans.map((plan) => plan.account)).toStrictEqual(["admin@example.invalid", "UNMAPPED"]);
    expect(doc.plans.map((plan) => plan.accountTrust)).toStrictEqual(["bound", "unmapped"]);
  });

  it("carries the thresholds it judged under in the register's own percents, so a later tick reuses them", () => {
    const base = {
      ambient: UNSHADOWED,
      cells: [],
      chair: NO_CHAIR,
      fleetWide: false,
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }) }],
      paused: [],
      planLines: [],
    } as const;
    const lowered = gaugeDocument({ ...base, thresholds: { ...DEFAULT_THRESHOLDS.claude, routeAt: 0.8 } });
    expect(documentOf(base).thresholds.routeAtPercent).toBe(95);
    expect(lowered.thresholds.routeAtPercent).toBe(80);
  });

  it("publishes a cached address as CACHED, so a parser cannot read it as the bound account", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      ambient: UNSHADOWED,
      cells: [{ alias: "plan-one", cell: { address: "admin@example.invalid", trust: "cached" } }],
      fleetWide: true,
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }) }],
    });
    expect(doc.plans[0]!.account).toBe("CACHED admin@example.invalid");
    expect(doc.plans[0]!.accountTrust).toBe("cached");
  });

  it("prints each swept plan's probe cost, and omits the key when a probe's cost went unmeasured", () => {
    const cost = { inputTokens: 34, outputTokens: 1 };
    const doc = documentOf({
      ambient: UNSHADOWED,
      cells: [],
      chair: NO_CHAIR,
      fleetWide: true,
      nowIso: NOW,
      outcomes: [
        { alias: "plan-one", gauge: gauge({ alias: "plan-one" }), probeCost: cost },
        { alias: "plan-two", gauge: gauge({ alias: "plan-two" }) },
      ],
      paused: [],
      planLines: [],
    });
    expect(doc.plans[0]!.probeCost).toStrictEqual(cost);
    expect(Object.keys(doc.plans[1]!).includes("probeCost")).toBe(false);
  });

  it("prints the chair's paused-plan probe cost, which no swept plan row carries", () => {
    const cost = { inputTokens: 99, outputTokens: 1 };
    const doc = documentOf({
      ambient: UNSHADOWED,
      cells: [],
      chair: NO_CHAIR,
      chairOutcomes: [{ alias: "plan-paused", probeCost: cost, problem: "the provider answered 500" }],
      fleetWide: true,
      nowIso: NOW,
      outcomes: [],
      paused: [],
      planLines: [],
    });
    expect(doc.chairProbeCost).toStrictEqual({ alias: "plan-paused", cost });
  });

  it("counts what it could read and what it could not, side by side", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      fleetWide: true,
      ambient: UNSHADOWED,
      nowIso: NOW,
      outcomes: [
        { alias: "plan-one", gauge: gauge({ alias: "plan-one" }) },
        { alias: "plan-two", problem: ClaudeRotationErrors.storeNotReady({ alias: "plan-two" }).message },
        { alias: "plan-three", gauge: gauge({ alias: "plan-three" }) },
      ],
    });
    expect(doc.readable).toBe(2);
    expect(doc.unreadable).toBe(1);
    expect(doc.observedAtIso).toBe(NOW);
  });

  it("KEEPS an unreadable plan in the document rather than dropping it", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      fleetWide: true,
      ambient: UNSHADOWED,
      nowIso: NOW,
      outcomes: [{ alias: "plan-two", problem: "the probe request could not be completed" }],
    });
    expect(doc.plans.length).toBe(1);
    expect(doc.plans[0]?.alias).toBe("plan-two");
    expect(doc.plans[0]?.problem).toBe("the probe request could not be completed");
  });

  it("reports an all-unreadable sweep as zero readable rather than as a healthy fleet", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      fleetWide: true,
      ambient: UNSHADOWED,
      nowIso: NOW,
      outcomes: [
        { alias: "plan-one", problem: "not signed in" },
        { alias: "plan-two", problem: "not signed in" },
      ],
    });
    expect(doc.readable).toBe(0);
    expect(doc.unreadable).toBe(2);
  });

  it("preserves configured order, which is the selection tie-break", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      fleetWide: true,
      ambient: UNSHADOWED,
      nowIso: NOW,
      outcomes: [{ alias: "first" }, { alias: "second" }, { alias: "third" }],
    });
    expect(doc.plans.map((plan) => plan.alias)).toStrictEqual(["first", "second", "third"]);
  });

  it("carries the ambient credential, so a reader cannot mistake a store reading for the fleet's spend", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      fleetWide: true,
      ambient: { kind: "shadowed", reason: "`ANTHROPIC_API_KEY` is set", source: "ANTHROPIC_API_KEY" },
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }) }],
    });
    expect(doc.readable).toBe(1);
    expect(doc.ambient.kind).toBe("shadowed");
    expect(doc.ambient.source).toBe("ANTHROPIC_API_KEY");
  });

  it("carries the balance block and the two decision lines on a fleet-wide sweep", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      ambient: UNSHADOWED,
      fleetWide: true,
      nextAllModels: "plan-two",
      nextFable: "plan-one",
      nowIso: NOW,
      outcomes: [
        { alias: "plan-one", gauge: gauge({ alias: "plan-one" }) },
        { alias: "plan-two", gauge: gauge({ alias: "plan-two" }) },
      ],
    });

    expect(doc.balance!.sevenDay.counted).toBe(2);
    expect(doc.balance!.leans).toHaveLength(2);
    expect(doc.balance!.nextAllModels).toBe("plan-two");
    expect(doc.balance!.nextFable).toBe("plan-one");
  });

  it("OMITS balance on a narrowed sweep, so one plan is never reported as an unread fleet", () => {
    const doc = documentOf({
      paused: [],
      planLines: [],
      chair: NO_CHAIR,
      cells: [],
      ambient: UNSHADOWED,
      fleetWide: false,
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }) }],
    });

    expect(doc.balance).toBeUndefined();
    expect(doc.readable).toBe(1);
  });

  it("carries the paused chair plan's reading WITH its own allowance and usage limit, for a tick to judge it by", () => {
    const chairReading: ClaudePlanGauge = { ...gauge({ alias: "plan-paused" }), usageLimitPercent: 50 };
    const doc = documentOf({
      paused: [{ alias: "plan-paused", reason: "resting", sinceIso: "2026-09-01T00:00:00.000Z" }],
      planLines: [],
      chair: NO_CHAIR,
      chairProbe: { chairReading },
      cells: [],
      ambient: UNSHADOWED,
      fleetWide: true,
      nowIso: NOW,
      outcomes: [{ alias: "plan-one", gauge: gauge({ alias: "plan-one" }) }],
    });

    expect(JSON.parse(JSON.stringify(doc.chairReading))).toStrictEqual({
      alias: "plan-paused",
      allowance: { kind: "weekly-window" },
      fiveHour: { resetAtIso: "2026-09-04T09:00:00.000Z", status: "allowed", utilization: 0.43 },
      observedAtIso: NOW,
      sevenDay: { resetAtIso: "2026-09-05T22:00:00.000Z", status: "allowed", utilization: 0.66 },
      usageLimitPercent: 50,
    });
  });

  it("serialises to JSON without carrying a credential", () => {
    const json = JSON.stringify(
      documentOf({
        paused: [],
        planLines: [],
        chair: NO_CHAIR,
        cells: [],
        fleetWide: true,
        ambient: UNSHADOWED,
        nowIso: NOW,
        outcomes: [{ alias: "p", gauge: gauge({ alias: "p" }) }],
      }),
    );
    expect(json).not.toContain("accessToken");
    expect(json).not.toContain("sk-ant");
  });
});
