/**
 * The survival trend's plan inputs: every configured plan, paused or not, carries the usage limit off its register
 * row into the trend, so no simulation spends a plan past what the owner allowed.
 */
import { describe, expect, it } from "vitest";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { survivalPlansOf } from "../../../claude/survivalPlanState.js";

const PAUSE = { reason: "a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" };

describe("survivalPlansOf", () => {
  it("keeps the register's order, each plan's pause and each plan's usage limit", () => {
    const accounts: readonly ClaudeAccount[] = [
      { alias: "plan-one", storeDir: "/fixture/plan-one", usageLimitPercent: 50 },
      { alias: "plan-two", paused: PAUSE, storeDir: "/fixture/plan-two", usageLimitPercent: 100 },
    ];
    expect(survivalPlansOf({ accounts })).toEqual([
      { alias: "plan-one", paused: undefined, usageLimitPercent: 50 },
      { alias: "plan-two", paused: PAUSE, usageLimitPercent: 100 },
    ]);
  });

  it("reads a hand-built account naming no limit as the whole plan", () => {
    expect(survivalPlansOf({ accounts: [{ alias: "plan-one", storeDir: "/fixture/plan-one" }] })).toEqual([
      { alias: "plan-one", paused: undefined, usageLimitPercent: 100 },
    ]);
  });

  it("is empty when no plan is configured", () => {
    expect(survivalPlansOf({ accounts: undefined })).toEqual([]);
  });
});
