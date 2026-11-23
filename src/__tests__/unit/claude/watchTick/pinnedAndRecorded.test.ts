/*
 * The two answers a watch tick takes without probing: the store this process is pinned to, which outranks every
 * probe and record and scopes a rotation to itself, and the rotation record, which expires with the credential
 * it describes.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeStoreIdentity } from "../../../../claude/checkoutIdentity.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../../claude/rotationState.js";
import { planWatchTick } from "../defaultThresholds.js";
import { ACCOUNTS, ALL_TOUCHED_LONG_AGO, gauge, HEALTHY, NOW, STALE } from "./harness.js";

describe("planWatchTick — the pinned store outranks every probe and every record", () => {
  // MEASURED on the owner's machine, which is the whole reason this answer exists. Every live
  // session is booted with CLAUDE_SECURESTORAGE_CONFIG_DIR naming one store, so the DEFAULT keychain item
  // that `probeActiveSlot` and the byte comparison both read had been left two days stale by a hand login.
  // Both probes therefore answered nothing, resolution fell through to
  // rotation-state.json's `selected: "plan-three"` from days earlier, and the tick skipped
  // plan-three as self-refreshing while the fleet ran on plan-one. plan-two, plan-three and plan-four then
  // expired together, eight hours after their sign-ins.
  it("skips the store this process is pinned to, NOT the one a stale record names", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      pinnedActive: "plan-one",
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-three",
        nowIso: "2026-09-05T11:00:00.000Z",
        reason: "a record written an hour ago and still wrong",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.activeFrom).toBe("pinned");
    expect(plan.touch).toStrictEqual(["plan-two", "plan-three"]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-one is the store this watch process is itself booted against, so it refreshes itself under " +
        "ordinary use",
    ]);
  });

  it("outranks the provider's own account answer, because a pin cannot go stale and a probe can", () => {
    const identities: readonly ClaudeStoreIdentity[] = [
      { alias: "plan-three", observedAtIso: STALE, organizationId: "org-three" },
    ];
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-three",
      identities,
      gauges: HEALTHY,
      nowIso: NOW,
      pinnedActive: "plan-two",
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-two");
    expect(plan.activeFrom).toBe("pinned");
  });

  it("answers nothing when the pin names a store no configured plan holds, rather than inventing one", () => {
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
    expect(plan.touch).toStrictEqual([]);
  });
});

describe("planWatchTick — the recorded answer expires with the credential it describes", () => {
  // The record describes one swap. An access token does not survive ACCESS_TOKEN_LIFETIME_HOURS without
  // being refreshed or replaced, so a record older than that is describing a credential that is gone. Once
  // the live record was FIVE DAYS old and the tick acted on it with full confidence.
  it("still answers from a record written inside one token lifetime", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-one",
        nowIso: "2026-09-05T05:00:00.000Z",
        reason: "seven hours before the tick",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.activeFrom).toBe("recorded");
  });

  it("refuses a record older than one token lifetime and touches NOTHING rather than skipping the wrong store", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-three",
        nowIso: "2026-09-05T03:00:00.000Z",
        reason: "nine hours before the tick, one hour past the lifetime",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBeUndefined();
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.touch).toStrictEqual([]);
  });

  it("treats a record that cannot say when it was written as too old, never as fresh", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: { ...EMPTY_ROTATION_STATE, selected: "plan-three" },
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBeUndefined();
    expect(plan.activeFrom).toBe("unknown");
  });
});

describe("planWatchTick — a pinned reading is about THIS process's store, never the default slot", () => {
  /** A gauge spent enough to make the trigger want to move. */
  const SPENT = [
    gauge({ alias: "plan-one", fiveHour: "0.97", fiveHourStatus: "allowed_warning" }),
    gauge({ alias: "plan-two" }),
    gauge({ alias: "plan-three" }),
  ];

  // `performClaudeSwap` mutates the DEFAULT keychain item. Under `pinned` the budgets judged belong to a
  // different item holding a different account, so a swap chosen from them would write the wrong
  // credential into the right-looking place — a known class.
  it("scopes a rotation chosen under a pin to process-pinned, so the shell may not perform it", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      gauges: SPENT,
      identities: [],
      nowIso: NOW,
      pinnedActive: "plan-one",
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("pinned");
    expect(plan.rotationScope).toBe("process-pinned");
  });

  it("still scopes an ordinary reading to the default slot, so nothing that worked stops working", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      gauges: SPENT,
      identities: [],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-one"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("observed");
    expect(plan.rotationScope).toBe("default-slot");
  });

  // The active-slot gauge is the DEFAULT item's budget. Stamping it onto the pinned alias would judge one
  // account's headroom under another account's name.
  it("does not stamp the default slot's own reading onto the pinned plan", () => {
    const activeSlotGauge = gauge({ alias: "active:slot", fiveHour: "0.99", fiveHourStatus: "allowed_warning" });
    const healthyPinned = planWatchTick({
      accounts: ACCOUNTS,
      activeSlotGauge,
      gauges: HEALTHY,
      identities: [],
      nowIso: NOW,
      pinnedActive: "plan-one",
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(healthyPinned.outcome.act).toBe("hold");
    expect(healthyPinned.rotateTo).toBeUndefined();
  });
});
