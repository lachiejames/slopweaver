/*
 * Which plan a watch tick names as active, and from what: the observed byte comparison over the record, the
 * provider's own account identity over both, elimination when exactly one store went unidentified, and
 * touching nothing whenever no single answer holds.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeStoreIdentity } from "../../../../claude/checkoutIdentity.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../../claude/rotationState.js";
import { planWatchTick } from "../defaultThresholds.js";
import { ACCOUNTS, ALL_TOUCHED_LONG_AGO, HEALTHY, NOW, RECENT_SWAP, STALE } from "./harness.js";

describe("planWatchTick — which plan is active", () => {
  it("prefers the OBSERVED active plan over the record, because the record goes stale on a hand login", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-three"],
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-three");
    expect(plan.activeFrom).toBe("observed");
  });

  it("falls back to the record when nothing could be observed", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.activeFrom).toBe("recorded");
  });

  it("says plainly that no plan is active rather than reporting healthy headroom on nothing", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBeUndefined();
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.why).toBe("no plan could be identified as active, so there is nothing to hold or move");
  });

  it("touches NOTHING when the active plan is unknown, because any store could be the live one", () => {
    // MEASURED on a merged main, which is what put this rule here. Both
    // existing guards were inert at once: the byte comparison had gone blind because ordinary use had
    // refreshed the active slot away from every store's copy (active 6.34h of life while two stores read
    // EXPIRED), and there was no rotation record for the alias guard to use. Every store was listed as due.
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.touch).toStrictEqual([]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-one is not being touched because no plan could be identified as active, so any store could be " +
        "the one whose account the active slot holds and refreshing it could revoke the live credential",
      "plan-two is not being touched because no plan could be identified as active, so any store could be " +
        "the one whose account the active slot holds and refreshing it could revoke the live credential",
      "plan-three is not being touched because no plan could be identified as active, so any store could be " +
        "the one whose account the active slot holds and refreshing it could revoke the live credential",
    ]);
  });

  it("still touches normally once the active plan IS identified, so the refusal is not a permanent stop", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-one"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("observed");
    expect(plan.touch).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("declines to guess when TWO stores hold the active slot's credential, and touches nothing", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-one", "plan-two"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });
});

describe("planWatchTick — the account identity outranks both weaker answers", () => {
  /** What the record holds once every store has answered a probe at least once. */
  const IDENTIFIED: readonly ClaudeStoreIdentity[] = [
    { alias: "plan-one", observedAtIso: STALE, organizationId: "org-aaa" },
    { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
    { alias: "plan-three", observedAtIso: STALE, organizationId: "org-ccc" },
  ];

  it("names the active plan from the provider's own account, with no bytes shared and no record", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-bbb",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("identified");
    expect(plan.active).toBe("plan-two");
  });

  it("keeps every other store alive once it can name the active one — the standstill this closes", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-bbb",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.touch).toStrictEqual(["plan-one", "plan-three"]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-two is the active plan (identified), so it refreshes itself under ordinary use",
    ]);
  });

  it("still refuses to touch a store whose bytes the active slot shares, even when identity named another", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-bbb",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-three"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-two");
    expect(plan.touch).toStrictEqual(["plan-one"]);
  });

  it("beats the byte comparison, which is only true between a swap and the next refresh", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-two"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("identified");
    expect(plan.active).toBe("plan-one");
  });

  it("beats a stale record, which a hand sign-in invalidates silently", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-ccc",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "an older swap",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("identified");
    expect(plan.active).toBe("plan-three");
  });

  it("falls back to the byte comparison when the active credential's account is unknown", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-two"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("observed");
    expect(plan.active).toBe("plan-two");
  });

  it("touches nothing when the active credential belongs to an account no store holds", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-signed-in-by-hand",
      gauges: HEALTHY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });

  it("touches nothing when two stores are recorded against the active account", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: [...IDENTIFIED, { alias: "plan-three", observedAtIso: STALE, organizationId: "org-aaa" }],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });
});

describe("planWatchTick — the elimination case, which is the one this machine is actually in", () => {
  /**
   * What the record holds on the owner's machine: the two idle stores answered a probe, and the ACTIVE
   * plan's own store answered 401 because the slot has refreshed past the credential it still holds.
   */
  const TWO_OF_THREE: readonly ClaudeStoreIdentity[] = [
    { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
    { alias: "plan-three", observedAtIso: STALE, organizationId: "org-ccc" },
  ];

  it("deduces the active plan as the one store nothing could identify", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: TWO_OF_THREE,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("deduced");
    expect(plan.active).toBe("plan-one");
  });

  it("keeps the other two stores alive, which is the standstill it exists to end", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: TWO_OF_THREE,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.touch).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("never eliminates when the provider did not answer for the active slot at all", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      gauges: HEALTHY,
      identities: TWO_OF_THREE,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });

  it("prefers a direct identity over elimination when one of the identified stores does match", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-ccc",
      gauges: HEALTHY,
      identities: TWO_OF_THREE,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("identified");
    expect(plan.active).toBe("plan-three");
  });

  it("touches nothing when two stores remain unidentified, because elimination names none", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: [{ alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" }],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });
});
