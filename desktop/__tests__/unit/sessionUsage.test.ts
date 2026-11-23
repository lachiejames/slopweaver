/*
 * What a hosted session has spent, folded turn by turn: each reported turn added once, a turn with no readable report
 * counted missing, a main-loop-only turn counted partial, and a rate that names which input it lacks rather than
 * reading zero.
 */
import { describe, expect, it } from "vitest";

import type { AppLaunchSpec, AppSessionSnapshot } from "../../src/sessionControlProtocol";
import {
  addTokens,
  modelMatches,
  modelMismatchOf,
  planPathOf,
  type SessionUsageState,
  sessionUsageOf,
  usageOfSpec,
  usageOnPrompt,
  usageOnReady,
  usageOnTurn,
  usageOnTurnClosed,
  usageRateOf,
  usageReportOf,
} from "../../src/sessionUsage";
import type { AppTurnUsage, ClaudeTokens } from "../../src/usageWire";

const AT = "2026-11-11T01:00:00.000Z";
const HOUR_LATER = "2026-11-11T02:00:00.000Z";

const CODEX: AppLaunchSpec = {
  codexHome: "/plans/codex-a",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  model: "gpt-5.6-sol",
  title: "abc-1",
  vendor: "codex",
};

function claudeSpec({ credential }: { credential: Extract<AppLaunchSpec, { vendor: "claude" }>["credential"] }) {
  const spec: AppLaunchSpec = {
    claudeMdExcludes: [],
    credential,
    directory: "/work/acme",
    ledgerKey: "abc-2",
    model: "opus",
    title: "abc-2",
    vendor: "claude",
  };
  return spec;
}

function claudeTokens({ total }: { total: number }): ClaudeTokens {
  return {
    cacheReadInputTokens: total - 3,
    cacheWriteInputTokens: 1,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: total,
    vendor: "claude",
  };
}

function reported({
  total,
  scope,
}: {
  total: number;
  scope: "comprehensive" | "main-loop-only";
}): Extract<AppTurnUsage, { kind: "reported" }> {
  return { chargedModels: ["claude-opus-5-5"], kind: "reported", scope, tokens: claudeTokens({ total }) };
}

const CLAUDE_FRESH: SessionUsageState = usageOfSpec({
  spec: claudeSpec({ credential: { kind: "store", secureStorageDir: "/plans/claude-a" } }),
});

function turn({ usage, value }: { usage: SessionUsageState; value: AppTurnUsage }): SessionUsageState {
  return usageOnTurn({ atIso: AT, turn: value, usage: usageOnPrompt({ usage }), vendor: "claude" });
}

describe("planPathOf", () => {
  it("names a Codex seat's plan by its home", () => {
    expect(planPathOf({ spec: CODEX })).toBe("/plans/codex-a");
  });

  it("names a Claude store login's plan by its store", () => {
    expect(
      planPathOf({ spec: claudeSpec({ credential: { kind: "store", secureStorageDir: "/plans/claude-a" } }) }),
    ).toBe("/plans/claude-a");
  });

  it("names a Claude setup-token seat's plan by the directory its token file sits in", () => {
    const spec = claudeSpec({
      credential: { kind: "setup-token", secureStorageDir: "/seat/unbound", tokenFilePath: "/plans/claude-b/token" },
    });
    expect(planPathOf({ spec })).toBe("/plans/claude-b");
  });
});

describe("usageOnTurn", () => {
  it("adds each reported turn once, and counts a partial one", () => {
    const usage = turn({
      usage: turn({ usage: CLAUDE_FRESH, value: reported({ scope: "main-loop-only", total: 100 }) }),
      value: reported({ scope: "comprehensive", total: 50 }),
    });
    expect(usage.total!.totalTokens).toBe(150);
    expect(usage.reportedTurns).toBe(2);
    expect(usage.partialTurns).toBe(1);
    expect(usage.missingTurns).toBe(0);
    expect(usage.turnOpen).toBe(false);
    expect(usage.chargedModels).toEqual(["claude-opus-5-5"]);
  });

  it("counts a turn with nothing readable as missing and leaves the total alone", () => {
    const first = turn({ usage: CLAUDE_FRESH, value: reported({ scope: "comprehensive", total: 40 }) });
    const usage = turn({ usage: first, value: { kind: "unreadable", reason: "odd" } });
    expect(usage.total!.totalTokens).toBe(40);
    expect(usage.missingTurns).toBe(1);
    expect(usage.lastTurn).toEqual({ atIso: AT, usage: { kind: "unreadable", reason: "odd" } });
  });

  it("refuses another vendor's tokens as unreadable and counts the turn missing", () => {
    const usage = usageOnTurn({
      atIso: AT,
      turn: reported({ scope: "comprehensive", total: 10 }),
      usage: usageOfSpec({ spec: CODEX }),
      vendor: "codex",
    });
    expect(usage.total).toBe(undefined);
    expect(usage.missingTurns).toBe(1);
    expect(usage.lastTurn).toEqual({
      atIso: AT,
      usage: { kind: "unreadable", reason: "a codex session reported claude tokens" },
    });
  });
});

describe("usageOnTurnClosed", () => {
  it("counts an open turn that ended unreported as missing", () => {
    const usage = usageOnTurnClosed({ atIso: AT, usage: usageOnPrompt({ usage: CLAUDE_FRESH }) });
    expect(usage.missingTurns).toBe(1);
    expect(usage.turnOpen).toBe(false);
    expect(usage.lastTurn).toEqual({ atIso: AT, usage: { kind: "not-reported" } });
  });

  it("lets a report arriving after its turn closed unreported replace that turn's missing count", () => {
    const closed = usageOnTurnClosed({ atIso: AT, usage: usageOnPrompt({ usage: CLAUDE_FRESH }) });
    const late = usageOnTurn({
      atIso: HOUR_LATER,
      turn: reported({ scope: "comprehensive", total: 30 }),
      usage: closed,
      vendor: "claude",
    });
    expect(late.missingTurns).toBe(0);
    expect(late.reportedTurns).toBe(1);
    expect(late.total!.totalTokens).toBe(30);
    expect(late.closedUnreported).toBe(false);
    const unreadable = usageOnTurn({
      atIso: HOUR_LATER,
      turn: { kind: "not-reported" },
      usage: closed,
      vendor: "claude",
    });
    expect(unreadable.missingTurns).toBe(1);
  });

  it("counts a report with no turn closed behind it as a turn of its own", () => {
    const reportedFirst = turn({ usage: CLAUDE_FRESH, value: reported({ scope: "comprehensive", total: 5 }) });
    const again = usageOnTurn({
      atIso: AT,
      turn: reported({ scope: "comprehensive", total: 5 }),
      usage: reportedFirst,
      vendor: "claude",
    });
    expect(again.reportedTurns).toBe(2);
    expect(again.missingTurns).toBe(0);
  });

  it("leaves a session with no open turn as it was", () => {
    const reportedFirst = turn({ usage: CLAUDE_FRESH, value: reported({ scope: "comprehensive", total: 5 }) });
    expect(usageOnTurnClosed({ atIso: HOUR_LATER, usage: reportedFirst })).toBe(reportedFirst);
  });
});

describe("addTokens", () => {
  it("has no sum for two vendors' tokens", () => {
    const codex = {
      cacheWriteInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      uncachedInputTokens: 0,
      vendor: "codex" as const,
    };
    expect(addTokens({ left: claudeTokens({ total: 5 }), right: codex })).toBe(undefined);
  });
});

describe("modelMatches and modelMismatchOf", () => {
  it("lets a Claude tier alias match its dated ids, and nothing else loosely", () => {
    expect(modelMatches({ asked: "opus", ran: "claude-opus-5-5" })).toBe(true);
    expect(modelMatches({ asked: "opus", ran: "claude-opus" })).toBe(true);
    expect(modelMatches({ asked: "opus", ran: "claude-sonnet-5-5" })).toBe(false);
    expect(modelMatches({ asked: "gpt-5.6-sol", ran: "gpt-5.6-sol" })).toBe(true);
    expect(modelMatches({ asked: "gpt-5.6-sol", ran: "gpt-6-astra" })).toBe(false);
  });

  it("flags a session charged to a model it did not ask for, a subagent's included", () => {
    const usage = turn({
      usage: { ...CLAUDE_FRESH, resolvedModel: "claude-opus-5-5" },
      value: { ...reported({ scope: "comprehensive", total: 9 }), chargedModels: ["claude-haiku-5-5"] },
    });
    expect(modelMismatchOf({ usage })).toBe(true);
    expect(modelMismatchOf({ usage: { ...CLAUDE_FRESH, resolvedModel: "claude-opus-5-5" } })).toBe(false);
  });

  it("flags nothing when the launch asked for no model", () => {
    const unpinned: SessionUsageState = {
      chargedModels: ["claude-haiku-5-5"],
      closedUnreported: false,
      missingTurns: 0,
      partialTurns: 0,
      planPath: "/plans/claude-a",
      reportedTurns: 1,
      resolvedModel: "claude-sonnet-5-5",
      turnOpen: false,
    };
    expect(modelMismatchOf({ usage: unpinned })).toBe(false);
  });
});

describe("usageRateOf", () => {
  it("names each missing input rather than reading zero", () => {
    expect(usageRateOf({ atIso: AT, usage: CLAUDE_FRESH })).toEqual({ kind: "not-ready" });
    const ready = usageOnReady({ atIso: AT, usage: CLAUDE_FRESH });
    expect(usageRateOf({ atIso: AT, usage: ready })).toEqual({ kind: "not-elapsed" });
    expect(usageRateOf({ atIso: HOUR_LATER, usage: ready })).toEqual({ kind: "not-reported" });
  });

  it("is tokens per hour since the FIRST ready", () => {
    const ready = usageOnReady({ atIso: AT, usage: CLAUDE_FRESH });
    const again = usageOnReady({ atIso: HOUR_LATER, usage: ready });
    const spent = turn({ usage: again, value: reported({ scope: "comprehensive", total: 600 }) });
    expect(spent.readySinceIso).toBe(AT);
    expect(usageRateOf({ atIso: HOUR_LATER, usage: spent })).toEqual({ kind: "reported", totalTokensPerHour: 600 });
  });
});

describe("usageReportOf", () => {
  const snapshot = ({ sessionId, ledgerKey }: { sessionId: string; ledgerKey: string }): AppSessionSnapshot => ({
    directory: "/work/acme",
    handle: `app:${sessionId}`,
    ledgerKey,
    openedAtIso: AT,
    sessionId,
    state: "idle",
    title: ledgerKey,
    vendor: "claude",
  });

  it("orders sessions by ledger key then id, and carries only the facts that exist", () => {
    const report = usageReportOf({
      atIso: AT,
      entries: [
        { snapshot: snapshot({ ledgerKey: "abc-2", sessionId: "b" }), usage: CLAUDE_FRESH },
        { snapshot: snapshot({ ledgerKey: "abc-1", sessionId: "c" }), usage: CLAUDE_FRESH },
        { snapshot: snapshot({ ledgerKey: "abc-2", sessionId: "a" }), usage: CLAUDE_FRESH },
      ],
    });
    expect(report.sessions.map((each) => each.sessionId)).toEqual(["c", "a", "b"]);
    expect(report.sessions[0]).toEqual({
      askedModel: "opus",
      chargedModels: [],
      ledgerKey: "abc-1",
      missingTurns: 0,
      modelMismatch: false,
      partialTurns: 0,
      planPath: "/plans/claude-a",
      rate: { kind: "not-ready" },
      reportedTurns: 0,
      sessionId: "c",
      state: "idle",
      title: "abc-1",
      turnOpen: false,
      vendor: "claude",
    });
  });

  it("carries a turn under way, so a reader can tell the total is a floor", () => {
    const record = sessionUsageOf({
      atIso: AT,
      snapshot: snapshot({ ledgerKey: "abc-1", sessionId: "c" }),
      usage: usageOnPrompt({ usage: CLAUDE_FRESH }),
    });
    expect(record.turnOpen).toBe(true);
  });
});
