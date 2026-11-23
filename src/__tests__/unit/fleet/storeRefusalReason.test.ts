/**
 * The credential half of the refusal table — a `STORE_REFUSED` row per routing refusal kind, and the sign-in button.
 */
import { describe, expect, it } from "vitest";

import type { FleetAccountNames } from "../../../fleet/refusals.js";
import { signinHeadline, signinStep, storeReason } from "../../../fleet/storeRefusalReason.js";

const ACCOUNTS: FleetAccountNames = { emailFor: ({ alias }) => (alias === "plan-one" ? "one@example.com" : undefined) };

describe("storeReason", () => {
  it("offers the spent-plan override only for a spent plan", () => {
    const spent = storeReason({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "spent", storeRefusal: "spent-plan" },
    });
    const unreadable = storeReason({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "no gauge", storeRefusal: "unreadable-plan" },
    });
    expect(spent.handStep!.action).toEqual({ hatch: "SLOPWEAVER_ALLOW_SPENT_PLAN", kind: "policy-override" });
    expect(unreadable.handStep).toBeUndefined();
  });

  it("offers no override for the usage limit the owner set, nor for a monthly-spend plan with no fresh spend reading, since none crosses either", () => {
    const limited = storeReason({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "limit", storeRefusal: "usage-limit" },
    });
    const monthly = storeReason({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "monthly", storeRefusal: "not-measured" },
    });
    expect(limited.headline).toBe("The account for this seat is at the usage limit you set.");
    expect(limited.handStep).toBeUndefined();
    expect(monthly.headline).toBe("The account for this seat is a monthly-spend plan with no fresh spend reading.");
    expect(monthly.handStep).toBeUndefined();
  });

  it("explains a signed-out plan with no token in the owner's words, keeping the producer's text under the fold", () => {
    const reason = storeReason({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-one", code: "STORE_REFUSED", message: "PRODUCER TEXT", storeRefusal: "configuration" },
    });
    expect(reason.headline).toBe("Sign in to one@example.com (plan-one).");
    expect(reason.detail).toBe(
      "That account is signed out and has no setup token, so a seat brought back on it would lock out again. Nothing was stopped; signing in once lets recovery carry on.",
    );
    expect(reason.raw).toBe("PRODUCER TEXT");
    expect(reason.handStep!.label).toBe("Sign in as one@example.com");
  });

  it("names the plan whose setup token would not read, and says 'this plan' when none is named", () => {
    const named = storeReason({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-two", code: "STORE_REFUSED", message: "t", storeRefusal: "token" },
    });
    const unnamed = storeReason({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "t", storeRefusal: "token" },
    });
    expect(named.detail).toBe(
      "The setup token for plan-two would not read, and recovery never falls back to the plan's store.",
    );
    expect(unnamed.detail).toBe(
      "The setup token for this plan would not read, and recovery never falls back to the plan's store.",
    );
    expect(named.handStep).toBeUndefined();
  });
});

describe("signinStep and signinHeadline", () => {
  it("labels the button by email and names the account in the headline", () => {
    expect(signinStep({ accounts: ACCOUNTS, alias: "plan-one" }).label).toBe("Sign in as one@example.com");
    expect(signinHeadline({ accounts: ACCOUNTS, alias: "plan-two" })).toBe(
      "Sign in to the account for plan-two (no email is mapped to it yet).",
    );
  });
});
