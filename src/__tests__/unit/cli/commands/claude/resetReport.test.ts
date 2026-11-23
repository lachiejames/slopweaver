/**
 * What `claude reset` prints: the status read as lines, and what each claim answer means for the exit. The exit is
 * the property a caller acts on — `already_used` is success only on a RESEND, where the lost answer most likely
 * reset, and a cooldown is not-yet rather than nothing to redeem.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeResetStatus } from "../../../../../claude/resetStatus.js";
import { renderResetStatus } from "../../../../../cli/commands/claude/resetRender.js";
import { type ClaimToSend, claimAnswerReport } from "../../../../../cli/commands/claude/resetSend.js";

const CLAIM: ClaimToSend = {
  body: "{}",
  grantId: "welcome-1",
  requestId: "req-1",
  resend: false,
  url: "https://api.anthropic.com/api/organizations/x/reset_rate_limits",
};

const STATUS: ClaudeResetStatus = {
  block: {
    atLimit: true,
    cooldownUntilIso: "2026-09-30T09:00:00.000Z",
    eligible: true,
    exhausted: ["seven_day"],
    grants: [
      {
        clears: ["seven_day"],
        endsAtIso: "2026-10-31T00:00:00.000Z",
        id: "welcome-1",
        label: "Welcome",
        paused: true,
        resetsLeft: 1,
        resetsTotal: 3,
        usableNow: false,
        useRequiresLimit: true,
      },
    ],
    nextGrantId: "welcome-1",
    weeklyResetsAtIso: "2026-10-01T11:00:00.000Z",
  },
};

describe("claimAnswerReport", () => {
  it("reports a reset as success, naming what it cleared and what is left", () => {
    expect(
      claimAnswerReport({
        alias: "plan-five",
        answer: { cleared: ["seven_day"], resetsLeft: 1, result: "reset" },
        claim: CLAIM,
      }),
    ).toEqual({
      code: 0,
      line: "claude reset: plan-five — reset on grant welcome-1, cleared seven_day, 1 reset(s) left (claim req-1)",
    });
  });

  it("reads already_used as success on a resend and as nothing to redeem on a fresh claim", () => {
    const answer = { cleared: [], reason: "used", result: "already_used" as const };

    expect(claimAnswerReport({ alias: "plan-five", answer, claim: { ...CLAIM, resend: true } }).code).toBe(0);
    expect(claimAnswerReport({ alias: "plan-five", answer, claim: CLAIM })).toEqual({
      code: 3,
      line: "claude reset: plan-five — already_used (used) on grant welcome-1 (claim req-1)",
    });
  });

  it("defers a cooldown and ends not_limited as nothing to redeem", () => {
    expect(
      claimAnswerReport({ alias: "plan-five", answer: { cleared: [], result: "cooldown" }, claim: CLAIM }).code,
    ).toBe(4);
    expect(
      claimAnswerReport({ alias: "plan-five", answer: { cleared: [], result: "not_limited" }, claim: CLAIM }).code,
    ).toBe(3);
  });
});

describe("renderResetStatus", () => {
  it("renders the block and each grant's state", () => {
    expect(renderResetStatus({ label: "plan-five (five@example.test)", source: "store", status: STATUS })).toEqual([
      "claude reset: plan-five (five@example.test) — read over its own store's login: eligible, at a limit (seven_day)",
      '  grant welcome-1 "Welcome": 1 of 3 reset(s) left, ends 2026-10-31T00:00:00.000Z, clears seven_day — not usable now, only at a limit, paused, next',
      "  cooldown until 2026-09-30T09:00:00.000Z",
      "  week resets on its own at 2026-10-01T11:00:00.000Z",
    ]);
  });

  it("names an ineligible plan's reason and an empty grant list", () => {
    const status: ClaudeResetStatus = {
      block: { atLimit: false, eligible: false, exhausted: [], grants: [], ineligibleReason: "team_plan" },
    };

    expect(renderResetStatus({ label: "plan-five", source: "default-slot", status })).toEqual([
      "claude reset: plan-five — read over the default slot's login: NOT eligible (team_plan), no window at its limit",
      "  no grant held",
    ]);
  });
});
