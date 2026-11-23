/**
 * `codex/resetEvidence.ts` — the one meaning of "at its limit" a reset is spent at, the reading a claim journals
 * either side of the consume, and which held reset a claim names.
 *
 * The limit is routing's pause bar (the register's `pauseAtPercent`, 99 by default) on a window still open: a store
 * the fleet drives stops taking work there, so a gate at 100% never opened. Exhaustion that is not a full window must
 * still not open it.
 */
import { describe, expect, it } from "vitest";

import { type CodexAccountLive, parseCodexAccountLive } from "../../../codex/accountLiveParse.js";
import { resetReadingOf, soonestExpiringAvailableCredit, storeAtLimit } from "../../../codex/resetEvidence.js";
import { epochSecondsToIso } from "../../../lib/date.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const HOME = "/stores/codex-a";
const READ_AT = "2026-09-25T13:00:00.000Z";
/** Four and a half days after {@link READ_AT}, so the window is still the open one. */
const RESETS_AHEAD = 1790736653;
/** An hour before {@link READ_AT}: the window this percentage describes has already reopened. */
const RESETS_PASSED = 1790337600;
/** The bars a register naming none decodes to — a 99% pause bar. */
const THRESHOLDS = DEFAULT_THRESHOLDS.codex;

/** A signed-in live read with one weekly window, built through the real parser. */
function live({
  bucketExtra = {},
  credits = { availableCount: 1, credits: null },
  resetsAt = RESETS_AHEAD,
  resultExtra = {},
  usedPercent,
}: {
  bucketExtra?: Record<string, unknown>;
  credits?: { availableCount: number; credits: readonly Record<string, unknown>[] | null };
  resetsAt?: number;
  resultExtra?: Record<string, unknown>;
  usedPercent: number;
}): CodexAccountLive {
  const bucket = {
    credits: { balance: "0", hasCredits: false, unlimited: false },
    limitId: "codex",
    planType: "pro",
    primary: { resetsAt, usedPercent, windowDurationMins: 10080 },
    secondary: null,
    ...bucketExtra,
  };
  return parseCodexAccountLive({
    codexHome: HOME,
    lines: [
      JSON.stringify({
        id: 2,
        result: {
          rateLimitResetCredits: credits,
          rateLimits: bucket,
          rateLimitsByLimitId: { codex: bucket },
          ...resultExtra,
        },
      }),
      JSON.stringify({ id: 3, result: { account: { email: "a@example.com", planType: "pro", type: "chatgpt" } } }),
    ],
    readAtIso: READ_AT,
  });
}

describe("storeAtLimit", () => {
  it("opens at routing's default 99% bar and not a hundredth below it", () => {
    expect(
      [98.99, 99, 100].map((usedPercent) => storeAtLimit({ live: live({ usedPercent }), thresholds: THRESHOLDS })),
    ).toEqual([false, true, true]);
  });

  it("moves with the register's pause bar — a store at 95% is at its limit once the owner sets the bar to 95", () => {
    const lowered = { ...THRESHOLDS, pauseAtPercent: 95 };
    expect(
      [94.99, 95].map((usedPercent) => storeAtLimit({ live: live({ usedPercent }), thresholds: lowered })),
    ).toEqual([false, true]);
    expect(storeAtLimit({ live: live({ usedPercent: 95 }), thresholds: THRESHOLDS })).toBe(false);
  });

  it("stays closed for a full window whose reset has already passed — that window is no longer the open one", () => {
    expect(storeAtLimit({ live: live({ resetsAt: RESETS_PASSED, usedPercent: 100 }), thresholds: THRESHOLDS })).toBe(
      false,
    );
  });

  it("stays closed for exhaustion that is not a full window — a credit balance, a reached type, ordinary usage off", () => {
    const depleted = live({
      bucketExtra: { rateLimitReachedType: "workspace_member_credits_depleted" },
      usedPercent: 0,
    });
    const noBalance = live({
      bucketExtra: { credits: { balance: 0, hasCredits: false, unlimited: false } },
      usedPercent: 0,
    });
    const ordinaryOff = live({ resultExtra: { ordinaryUsageAllowed: false }, usedPercent: 0 });
    expect(
      [depleted, noBalance, ordinaryOff].map((read) => storeAtLimit({ live: read, thresholds: THRESHOLDS })),
    ).toEqual([false, false, false]);
  });

  it("is false for a store nothing is signed into", () => {
    expect(
      storeAtLimit({ live: { codexHome: HOME, kind: "signed-out", readAtIso: READ_AT }, thresholds: THRESHOLDS }),
    ).toBe(false);
  });
});

describe("resetReadingOf", () => {
  it("carries every window, whether it was at the limit, and the held resets exactly as read", () => {
    const credits = { availableCount: 1, credits: [{ expiresAt: RESETS_AHEAD, id: "credit-1", status: "available" }] };
    const reading = resetReadingOf({ live: live({ credits, usedPercent: 99 }), thresholds: THRESHOLDS })!;
    expect(reading.atLimit).toBe(true);
    expect(reading.readAtIso).toBe(READ_AT);
    expect(reading.resetCreditsAvailable).toBe(1);
    expect(reading.resetCreditsListed).toEqual([
      { expiresAtIso: epochSecondsToIso({ seconds: RESETS_AHEAD }), id: "credit-1", status: "available" },
    ]);
    expect(reading.windows[0]).toEqual({
      label: "weekly",
      limitId: "codex",
      resetAtIso: epochSecondsToIso({ seconds: RESETS_AHEAD }),
      slot: "primary",
      usedPercent: 99,
      windowMinutes: 10080,
    });
  });

  it("records nothing for a store nothing is signed into", () => {
    expect(
      resetReadingOf({
        live: { codexHome: HOME, kind: "store-missing", readAtIso: READ_AT },
        thresholds: THRESHOLDS,
      }),
    ).toBeUndefined();
  });
});

describe("soonestExpiringAvailableCredit", () => {
  it("names the available reset that lapses first, skipping spent and undated ones", () => {
    const credits = [
      { expiresAtIso: "2026-11-01T00:00:00.000Z", id: "spent", status: "redeemed" },
      { id: "undated", status: "available" },
      { expiresAtIso: "2026-11-30T00:00:00.000Z", id: "late", status: "available" },
      { expiresAtIso: "2026-11-06T00:00:00.000Z", id: "soon-b", status: "available" },
      { expiresAtIso: "2026-11-06T00:00:00.000Z", id: "soon-a", status: "available" },
    ];
    expect(soonestExpiringAvailableCredit({ credits })!.id).toBe("soon-a");
  });

  it("leaves the pick to the provider when nothing dated is held or nothing was itemised", () => {
    expect(soonestExpiringAvailableCredit({ credits: [{ id: "undated", status: "available" }] })).toBeUndefined();
    expect(soonestExpiringAvailableCredit({ credits: undefined })).toBeUndefined();
  });
});
