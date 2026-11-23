/*
 * What `cmux usage` prints: each plan's line, then its sessions with model facts ahead of tokens. A fact the app did
 * not have reads not-reported or unknown, never 0; a total with a missing turn behind it says it is a floor; Codex's
 * context occupancy is labelled as not spend.
 */
import { describe, expect, it } from "vitest";

import { planLine, rateText, sessionLines, usageLines } from "../../../cli/commands/cmux/usageOutput.js";
import { usageViewOf } from "../../../sessionHarness/appUsage.js";
import type { AppSessionUsage } from "../../../sessionHarness/usageWire.js";

const AT = "2026-11-11T02:00:00.000Z";

const QUIET: AppSessionUsage = {
  chargedModels: [],
  ledgerKey: "abc-1",
  missingTurns: 0,
  modelMismatch: false,
  partialTurns: 0,
  planPath: "/plans/b",
  rate: { kind: "not-ready" },
  reportedTurns: 0,
  sessionId: "s1",
  state: "starting",
  title: "abc-1 title",
  turnOpen: false,
  vendor: "codex",
};

const SPENT: AppSessionUsage = {
  ...QUIET,
  askedModel: "gpt-5.6-sol",
  chargedModels: ["gpt-6-astra"],
  context: { atIso: AT, sizeTokens: 272_000, usedTokens: 41_000 },
  lastTurn: { atIso: AT, usage: { kind: "not-reported" } },
  missingTurns: 1,
  modelMismatch: true,
  rate: { kind: "reported", totalTokensPerHour: 1499.6 },
  reportedTurns: 2,
  resolvedModel: "gpt-5.6-sol",
  state: "idle",
  total: {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 800,
    outputTokens: 50,
    reasoningOutputTokens: 30,
    totalTokens: 1050,
    uncachedInputTokens: 200,
    vendor: "codex",
  },
};

describe("sessionLines", () => {
  it("prints a session that has said nothing as unknown and not-reported, never zero", () => {
    expect(sessionLines({ usage: QUIET })).toEqual([
      "  abc-1 · abc-1 title · codex · starting",
      "    model: asked none · ran unknown · charged none yet",
      "    tokens: not-reported · 0 turn(s) counted",
      "    last turn: none yet · rate not-ready",
    ]);
  });

  it("prints model facts first, then tokens as a floor, and occupancy as not spend", () => {
    expect(sessionLines({ usage: SPENT })).toEqual([
      "  abc-1 · abc-1 title · codex · idle",
      "    model: asked gpt-5.6-sol · ran gpt-5.6-sol · charged gpt-6-astra · OFF THE MODEL ASKED",
      "    tokens: uncached input 200 · cached input 800 · cache write 0 · output 50 · reasoning 30 · total 1050 · 2 turn(s) counted · a floor: 1 turn(s) not reported",
      `    last turn: not-reported at ${AT} · 1500 tokens/hour since ready`,
      `    context occupancy; not spend: 41000 of 272000 at ${AT}`,
    ]);
  });
});

describe("a turn under way", () => {
  it("prints the session's total and its plan's as a floor until the turn reports", () => {
    const running: AppSessionUsage = {
      ...SPENT,
      missingTurns: 0,
      modelMismatch: false,
      state: "running",
      turnOpen: true,
    };
    expect(sessionLines({ usage: running })[2]).toBe(
      "    tokens: uncached input 200 · cached input 800 · cache write 0 · output 50 · reasoning 30 · total 1050 · 2 turn(s) counted · a floor: a turn under way, counted at its end",
    );
    const view = usageViewOf({ plans: [], report: { atIso: AT, sessions: [running] } });
    expect(planLine({ summary: view.plans[0]! })).toBe(
      "plan unregistered (/plans/b) · codex · 1 session(s), 1 reporting, 1 incomplete, 0 off the model asked · total 1050 (a floor)",
    );
  });
});

describe("rateText", () => {
  it("names a missing input by kind", () => {
    expect(rateText({ rate: { kind: "not-elapsed" } })).toBe("rate not-elapsed");
  });
});

describe("planLine and usageLines", () => {
  it("names an unregistered store by its path and marks a floored total", () => {
    const view = usageViewOf({ plans: [], report: { atIso: AT, sessions: [SPENT] } });
    expect(planLine({ summary: view.plans[0]! })).toBe(
      "plan unregistered (/plans/b) · codex · 1 session(s), 1 reporting, 1 incomplete, 1 off the model asked · total 1050 (a floor)",
    );
  });

  it("prints each plan followed by its own sessions", () => {
    const other: AppSessionUsage = { ...QUIET, ledgerKey: "abc-2", planPath: "/plans/c", sessionId: "s2" };
    const view = usageViewOf({
      plans: [{ alias: "codex-b", provider: "codex", storeDir: "/plans/b" }],
      report: { atIso: AT, sessions: [QUIET, other] },
    });
    const lines = usageLines({ view });
    expect(lines[0]).toBe(`usage read ${AT}, this run of the app only; spend lands at each turn's end`);
    expect(lines[1]).toBe(
      "plan codex-b · codex · 1 session(s), 0 reporting, 0 incomplete, 0 off the model asked · total not-reported",
    );
    expect(lines[2]).toBe("  abc-1 · abc-1 title · codex · starting");
    expect(lines[6]).toBe(
      "plan unregistered (/plans/c) · codex · 1 session(s), 0 reporting, 0 incomplete, 0 off the model asked · total not-reported",
    );
    expect(lines[7]).toBe("  abc-2 · abc-1 title · codex · starting");
  });

  it("says so when the app hosted nothing", () => {
    expect(usageLines({ view: usageViewOf({ plans: [], report: { atIso: AT, sessions: [] } }) })).toEqual([
      `no sessions hosted in this run of the app (read ${AT})`,
    ]);
  });
});
