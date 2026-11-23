/*
 * The keep-alive half of a watch tick: which stores it refreshes, and which it holds back because the active
 * slot shares their credential, the record names them active, or they are still inside the interval.
 */
import { describe, expect, it } from "vitest";

import { KEEP_ALIVE_INTERVAL_HOURS } from "../../../../claude/keepAlive.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../../claude/rotationState.js";
import { planWatchTick } from "../defaultThresholds.js";
import { ACCOUNTS, ALL_TOUCHED_LONG_AGO, HEALTHY, NOW, RECENT_SWAP } from "./harness.js";

describe("planWatchTick — the keep-alive half", () => {
  it("never refreshes a store whose credential the ACTIVE slot is also holding", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: ["plan-three"],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.touch).toStrictEqual(["plan-one", "plan-two"]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-three holds the same credential as the active slot, so refreshing it would revoke the token " +
        "every running session is authenticating with",
    ]);
  });

  it("guards on the shared credential even with NO rotation record, which is how this install reads", () => {
    // MEASURED: `rotation-state.json` did not exist on this machine, so a guard resting on the
    // recorded alias alone excluded nothing at all. This is that case, and it must still hold.
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
    expect(plan.touch).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("also holds back the RECORDED active plan, which refreshes itself under ordinary use", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: selectAccount({
        alias: "plan-two",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.touch).toStrictEqual(["plan-one", "plan-three"]);
    expect(plan.touchSkipped).toStrictEqual([
      "plan-two is the active plan (recorded), so it refreshes itself under ordinary use",
    ]);
  });

  it("refreshes every store EXCEPT the active one once the active plan is known", () => {
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
    expect(plan.touch).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("refreshes nothing while every store is inside the keep-alive interval", () => {
    const fresh = new Date(Date.parse(NOW) - (KEEP_ALIVE_INTERVAL_HOURS - 0.1) * 3_600_000).toISOString();
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ACCOUNTS.map((account) => ({ alias: account.alias, lastTouchedIso: fresh })),
    });
    expect(plan.touch).toStrictEqual([]);
  });
});
