/**
 * The strict read of the usage answer's `extra_usage` block. The subscription fixture is the shape measured live on
 * (see the knowledge register), synthetic in every value; the Enterprise-shaped one is the shape
 * Claude Code documents for a plan with a spend limit, and is unmeasured on a real seat.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { parseResetStatus } from "../../../claude/resetStatus.js";
import { ClaudeSpendErrors } from "../../../claude/spendErrors.js";
import { parseClaudeSpendStatus, SPEND_STATUS_URL } from "../../../claude/spendStatus.js";

/** The `extra_usage` block a Max subscription sent, every amount null. */
const SUBSCRIPTION_BLOCK = {
  credits_ever_enabled: false,
  currency: null,
  daily: null,
  decimal_places: null,
  disabled_reason: null,
  is_enabled: false,
  monthly_limit: null,
  spend_limit_reached: false,
  used_credits: null,
  user_disabled: false,
  utilization: null,
  weekly: null,
};

/** A block for a plan with a 500.00 USD monthly limit, 123.45 USD spent. */
const LIMITED_BLOCK = {
  ...SUBSCRIPTION_BLOCK,
  currency: "USD",
  decimal_places: 2,
  is_enabled: true,
  monthly_limit: 50_000,
  used_credits: 12_345,
  utilization: 24.69,
};

/** A whole answer around one block, with a sibling the reader does not read. */
function bodyOf({ block }: { block: unknown }): string {
  return JSON.stringify({ extra_usage: block, seven_day: { utilization: 62 }, spend: { percent: 0 } });
}

describe("parseClaudeSpendStatus", () => {
  it("reads the unskipped usage answer, never the skip_spend one", () => {
    expect(SPEND_STATUS_URL).toBe("https://api.anthropic.com/api/oauth/usage");
  });

  it("keeps a subscription's null amounts null rather than reading them as nothing spent", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: SUBSCRIPTION_BLOCK }) });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({
      currency: null,
      decimalPlaces: null,
      isEnabled: false,
      monthlyLimitMinor: null,
      spendLimitReached: false,
      usedMinor: null,
    });
  });

  it("reads a monthly limit and the month's spend in minor units", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: LIMITED_BLOCK }) });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({
      currency: "USD",
      decimalPlaces: 2,
      isEnabled: true,
      monthlyLimitMinor: 50_000,
      spendLimitReached: false,
      usedMinor: 12_345,
    });
  });

  it("refuses an answer with no extra_usage block as absent, never zero", () => {
    const read = parseClaudeSpendStatus({ bodyText: JSON.stringify({ seven_day: null }) });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(ClaudeSpendErrors.blockAbsent());
  });

  it("refuses an enabled block with a null spend, naming the field, rather than a reading with a hole", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: { ...LIMITED_BLOCK, used_credits: null } }) });
    expect(unwrapErr(read)).toEqual(ClaudeSpendErrors.amountAbsent({ fields: ["used_credits"] }));
  });

  it("refuses an enabled block whose currency is only whitespace, naming it", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: { ...LIMITED_BLOCK, currency: " " } }) });
    expect(unwrapErr(read)).toEqual(ClaudeSpendErrors.amountAbsent({ fields: ["currency"] }));
  });

  it("refuses an enabled block with no limit and no currency, naming both", () => {
    const read = parseClaudeSpendStatus({
      bodyText: bodyOf({ block: { ...LIMITED_BLOCK, currency: null, monthly_limit: null } }),
    });
    expect(unwrapErr(read)).toEqual(ClaudeSpendErrors.amountAbsent({ fields: ["monthly_limit", "currency"] }));
  });

  it("reads a block at its spend limit with null amounts, since the refusal is the provider's own", () => {
    const read = parseClaudeSpendStatus({
      bodyText: bodyOf({ block: { ...LIMITED_BLOCK, spend_limit_reached: true, used_credits: null } }),
    });
    expect(unwrap(read)).toMatchObject({ spendLimitReached: true, usedMinor: null });
  });

  it("refuses a null extra_usage block as absent", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: null }) });
    expect(unwrapErr(read).code).toBe("SPEND_BLOCK_ABSENT");
  });

  it("refuses a block missing a field it reads, naming it", () => {
    const { used_credits: _dropped, ...withoutUsed } = LIMITED_BLOCK;
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: withoutUsed }) });
    expect(unwrapErr(read).code).toBe("SPEND_STATUS_UNREADABLE");
    expect(unwrapErr(read).message).toContain("used_credits");
  });

  it("refuses a block carrying a field nobody declared, naming it", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: { ...LIMITED_BLOCK, seat_limit: 1 } }) });
    expect(unwrapErr(read).code).toBe("SPEND_STATUS_UNREADABLE");
    expect(unwrapErr(read).message).toContain("seat_limit");
  });

  it("refuses a negative spend", () => {
    const read = parseClaudeSpendStatus({ bodyText: bodyOf({ block: { ...LIMITED_BLOCK, used_credits: -1 } }) });
    expect(unwrapErr(read).code).toBe("SPEND_STATUS_UNREADABLE");
  });

  it("refuses an amount sent as text", () => {
    const read = parseClaudeSpendStatus({
      bodyText: bodyOf({ block: { ...LIMITED_BLOCK, monthly_limit: "50000" } }),
    });
    expect(unwrapErr(read).code).toBe("SPEND_STATUS_UNREADABLE");
  });

  it("refuses a top-level key the provider added, naming it", () => {
    const read = parseClaudeSpendStatus({
      bodyText: JSON.stringify({ extra_usage: LIMITED_BLOCK, velvet_harbor: true }),
    });
    expect(unwrapErr(read).message).toContain("velvet_harbor");
  });

  it("refuses a body that is not JSON", () => {
    const read = parseClaudeSpendStatus({ bodyText: "<html>" });
    expect(unwrapErr(read).code).toBe("SPEND_STATUS_UNREADABLE");
  });
});

describe("the shared usage key list", () => {
  it("still lets the reset reader read an answer whose extra_usage block it does not read", () => {
    const read = parseResetStatus({
      bodyText: JSON.stringify({
        cedar_ember: { eligible: false, grants: [] },
        extra_usage: { anything: "goes" },
      }),
    });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).block.eligible).toBe(false);
  });

  it("still refuses a top-level key neither reader declared, in the reset reader too", () => {
    const read = parseResetStatus({
      bodyText: JSON.stringify({ cedar_ember: { eligible: false }, velvet_harbor: true }),
    });
    expect(unwrapErr(read).message).toContain("velvet_harbor");
  });
});
