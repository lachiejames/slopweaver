/*
 * The rotation half of a watch tick, which writes nothing: when it holds, which plan it recommends and why,
 * that a hold never claims headroom it did not read, and that the active slot's own reading is the active
 * plan's budget.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeStoreIdentity } from "../../../../claude/checkoutIdentity.js";
import { EMPTY_ROTATION_STATE, holdAccount, selectAccount } from "../../../../claude/rotationState.js";
import { classifyLimitRecord } from "../../../../claude/transcriptSignal.js";
import { planWatchTick } from "../defaultThresholds.js";
import { ACCOUNTS, ALL_TOUCHED_LONG_AGO, gauge, HEALTHY, NOW, RECENT_SWAP, STALE } from "./harness.js";

describe("planWatchTick — the rotation half, which writes nothing", () => {
  it("holds while the active plan has plan-wide headroom", () => {
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
    expect(plan.outcome.act).toBe("hold");
    expect(plan.rotateTo).toBeUndefined();
    expect(plan.why).toBe("the active plan has plan-wide headroom");
  });

  it("names the target it RECOMMENDS, never one it is moving onto", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: [gauge({ alias: "plan-one", fiveHour: "0.96" }), gauge({ alias: "plan-two" })],
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
    expect(plan.rotateTo).toBe("plan-two");
    // "RECOMMENDING", not "rotating": this sentence reaches the human report AND the JSON record, and the
    // credential copy is retired, so a tick performs no rotation. Claiming
    // the act is the one thing a line everybody reads must not do.
    expect(plan.why).toBe(
      "RECOMMENDING plan-two as the plan to boot against — five_hour reached the rotation threshold before a wall",
    );
  });

  it("prefers a plan whose weekly window resets sooner, through the real selection ordering", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: [
        gauge({ alias: "plan-one", fiveHour: "0.96" }),
        gauge({ alias: "plan-two", sevenDayReset: "1789300000" }),
        gauge({ alias: "plan-three", sevenDayReset: "1788900000" }),
      ],
      nowIso: NOW,
      reserved: "plan-three",
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
    expect(plan.rotateTo).toBe("plan-two");
  });

  it("keeps a plan under an unexpired hold out of selection, so the fleet cannot flap back onto it", () => {
    const held = holdAccount({
      alias: "plan-two",
      reason: "five_hour refused",
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      untilIso: "2026-09-05T18:00:00.000Z",
    });
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: [
        gauge({ alias: "plan-one", fiveHour: "0.96" }),
        gauge({ alias: "plan-two" }),
        gauge({ alias: "plan-three" }),
      ],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: held,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.held).toStrictEqual(["plan-two"]);
    expect(plan.rotateTo).toBe("plan-three");
  });

  it("reports every plan spent with the reason, rather than flattening it into a hold", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: [
        gauge({ alias: "plan-one", fiveHour: "0.96" }),
        gauge({ alias: "plan-two", fiveHour: "0.99" }),
        gauge({ alias: "plan-three", fiveHour: "0.97" }),
      ],
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
    expect(plan.rotateTo).toBeUndefined();
    expect(plan.outcome.act).toBe("rotate");
    expect(plan.why).toBe(
      "every plan is spent, so there is nothing to rotate onto — five_hour reached the rotation threshold before a wall",
    );
  });

  it("carries a REAL classified transcript line through to a per-model answer for a worker", () => {
    const signal = classifyLimitRecord({
      record: {
        apiErrorStatus: 429,
        isApiErrorMessage: true,
        message: {
          content: [{ text: "You've reached your Fable limit. Run /usage-credits to continue", type: "text" }],
          role: "assistant",
        },
      },
    });
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      identities: [],
      gauges: HEALTHY,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      signal,
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.outcome.act).toBe("downgrade-model");
    expect(plan.rotateTo).toBeUndefined();
  });
});

describe("planWatchTick — a hold never claims headroom it did not read", () => {
  it("says the active plan's budget is unknown when no gauge was taken for it", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: [gauge({ alias: "plan-two" }), gauge({ alias: "plan-three" })],
      identities: [
        { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
        { alias: "plan-three", observedAtIso: STALE, organizationId: "org-ccc" },
      ],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.outcome.act).toBe("hold");
    expect(plan.why).toBe("no reading for the active plan, so its remaining budget is unknown");
  });

  it("still says headroom when the active plan's own reading shows it", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      gauges: HEALTHY,
      identities: [
        { alias: "plan-one", observedAtIso: STALE, organizationId: "org-aaa" },
        { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
        { alias: "plan-three", observedAtIso: STALE, organizationId: "org-ccc" },
      ],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.why).toBe("the active plan has plan-wide headroom");
  });
});

describe("planWatchTick — the active slot's own reading is the active plan's budget", () => {
  const IDENTIFIED: readonly ClaudeStoreIdentity[] = [
    { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
    { alias: "plan-three", observedAtIso: STALE, organizationId: "org-ccc" },
  ];

  /** The two idle stores answered; the plan the fleet is on could not, which is the ordinary steady state. */
  const IDLE_ONLY = [gauge({ alias: "plan-two" }), gauge({ alias: "plan-three" })];

  it("rotates on a wall the active slot reported, which no store gauge could have shown", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      activeSlotGauge: gauge({ alias: "active:slot", fiveHour: "0.97" }),
      gauges: IDLE_ONLY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.outcome.act).toBe("rotate");
    expect(plan.rotateTo).toBe("plan-two");
  });

  it("holds when the active slot reports headroom, and says so rather than saying nobody looked", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      activeSlotGauge: gauge({ alias: "active:slot", fiveHour: "0.14" }),
      gauges: IDLE_ONLY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.outcome.act).toBe("hold");
    expect(plan.why).toBe("the active plan has plan-wide headroom");
  });

  it("replaces the active plan's own stale store reading rather than counting the plan twice", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeOrganizationId: "org-aaa",
      activeSlotGauge: gauge({ alias: "active:slot", fiveHour: "0.96" }),
      gauges: [gauge({ alias: "plan-one", fiveHour: "0.02" }), gauge({ alias: "plan-two" })],
      identities: [
        { alias: "plan-one", observedAtIso: STALE, organizationId: "org-aaa" },
        { alias: "plan-two", observedAtIso: STALE, organizationId: "org-bbb" },
      ],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.active).toBe("plan-one");
    expect(plan.rotateTo).toBe("plan-two");
  });

  it("ignores the slot's reading entirely when no plan could be named for it", () => {
    const plan = planWatchTick({
      accounts: ACCOUNTS,
      activeSlotGauge: gauge({ alias: "active:slot", fiveHour: "0.97" }),
      gauges: IDLE_ONLY,
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      state: EMPTY_ROTATION_STATE,
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.activeFrom).toBe("unknown");
    expect(plan.outcome.act).toBe("hold");
  });
});
