/*
 * The app's usage report as `cmux usage` reads it: each session's store resolved to a registered plan of its own
 * vendor or named unregistered, and each plan summed without ever adding two vendors' categories together.
 */
import { describe, expect, it } from "vitest";
import {
  isIncomplete,
  planNameOf,
  sumTokens,
  type UsagePlanEntry,
  usageViewOf,
} from "../../../sessionHarness/appUsage.js";
import type { AppSessionUsage, AppUsageReport } from "../../../sessionHarness/usageWire.js";

const AT = "2026-11-11T02:00:00.000Z";

const PLANS: readonly UsagePlanEntry[] = [
  { alias: "claude-a", provider: "claude", storeDir: "/plans/a" },
  { alias: "codex-a", provider: "codex", storeDir: "/plans/a" },
  { alias: "codex-b", provider: "codex", storeDir: "/plans/b" },
];

function codexSession({
  sessionId,
  planPath,
  total,
  missingTurns = 0,
}: {
  sessionId: string;
  planPath: string;
  total?: number;
  missingTurns?: number;
}): AppSessionUsage {
  const base: AppSessionUsage = {
    chargedModels: ["gpt-5.6-sol"],
    ledgerKey: `abc-${sessionId}`,
    missingTurns,
    modelMismatch: false,
    partialTurns: 0,
    planPath,
    rate: { kind: "not-reported" },
    reportedTurns: total === undefined ? 0 : 1,
    sessionId,
    state: "idle",
    title: `abc-${sessionId}`,
    turnOpen: false,
    vendor: "codex",
  };
  if (total === undefined) {
    return base;
  }
  return {
    ...base,
    total: {
      cacheWriteInputTokens: 0,
      cachedInputTokens: total - 10,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: total,
      uncachedInputTokens: 5,
      vendor: "codex",
    },
  };
}

describe("planNameOf", () => {
  it("resolves a store to the plan of the SAME vendor that holds it", () => {
    expect(planNameOf({ planPath: "/plans/a", plans: PLANS, vendor: "codex" })).toEqual({
      alias: "codex-a",
      kind: "registered",
    });
    expect(planNameOf({ planPath: "/plans/a", plans: PLANS, vendor: "claude" })).toEqual({
      alias: "claude-a",
      kind: "registered",
    });
  });

  it("names a store no plan holds unregistered, never a guessed alias", () => {
    expect(planNameOf({ planPath: "/plans/b", plans: PLANS, vendor: "claude" })).toEqual({ kind: "unregistered" });
    expect(planNameOf({ planPath: "/plans/a", plans: [], vendor: "codex" })).toEqual({ kind: "unregistered" });
  });
});

describe("usageViewOf", () => {
  it("sums a plan's sessions and counts the ones whose total is a floor", () => {
    const report: AppUsageReport = {
      atIso: AT,
      sessions: [
        codexSession({ planPath: "/plans/b", sessionId: "1", total: 100 }),
        codexSession({ missingTurns: 1, planPath: "/plans/b", sessionId: "2", total: 50 }),
        codexSession({ planPath: "/plans/b", sessionId: "3" }),
        codexSession({ planPath: "/plans/a", sessionId: "4", total: 20 }),
      ],
    };
    const view = usageViewOf({ plans: PLANS, report });
    expect(view.plans.map((plan) => plan.plan)).toEqual([
      { alias: "codex-b", kind: "registered" },
      { alias: "codex-a", kind: "registered" },
    ]);
    const [b, a] = view.plans;
    expect(b!.sessionCount).toBe(3);
    expect(b!.reportingSessionCount).toBe(2);
    expect(b!.incompleteSessionCount).toBe(1);
    expect(b!.total).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 130,
      outputTokens: 8,
      reasoningOutputTokens: 2,
      totalTokens: 150,
      uncachedInputTokens: 10,
      vendor: "codex",
    });
    expect(a!.total!.totalTokens).toBe(20);
  });

  it("leaves a plan whose sessions never reported with no total rather than zero", () => {
    const view = usageViewOf({
      plans: PLANS,
      report: { atIso: AT, sessions: [codexSession({ planPath: "/plans/b", sessionId: "1" })] },
    });
    expect(view.plans[0]!.total).toBe(undefined);
    expect(view.plans[0]!.reportingSessionCount).toBe(0);
  });

  it("keeps a Claude and a Codex session on one store as two plans", () => {
    const claude: AppSessionUsage = { ...codexSession({ planPath: "/plans/a", sessionId: "5" }), vendor: "claude" };
    const view = usageViewOf({
      plans: PLANS,
      report: { atIso: AT, sessions: [claude, codexSession({ planPath: "/plans/a", sessionId: "6", total: 9 })] },
    });
    expect(view.plans.map((plan) => [plan.vendor, plan.plan])).toEqual([
      ["claude", { alias: "claude-a", kind: "registered" }],
      ["codex", { alias: "codex-a", kind: "registered" }],
    ]);
  });
});

describe("sumTokens and isIncomplete", () => {
  it("has no sum across vendors", () => {
    const codex = codexSession({ planPath: "/p", sessionId: "1", total: 10 }).total!;
    const claude = {
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      vendor: "claude" as const,
    };
    expect(sumTokens({ left: codex, right: claude })).toBe(undefined);
  });

  it("calls a session with a partial turn incomplete", () => {
    expect(isIncomplete({ usage: { ...codexSession({ planPath: "/p", sessionId: "1" }), partialTurns: 1 } })).toBe(
      true,
    );
    expect(isIncomplete({ usage: codexSession({ planPath: "/p", sessionId: "1" }) })).toBe(false);
  });
});
