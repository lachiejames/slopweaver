import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../claude/rotationState.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { planWatchTick } from "../../../claude/watchTick.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

/** A tick under the default thresholds, which every case not about a threshold is judged by. */
const planTick = ({
  spends = [],
  ...args
}: Omit<Parameters<typeof planWatchTick>[0], "spends" | "thresholds"> & {
  spends?: Parameters<typeof planWatchTick>[0]["spends"];
}): ReturnType<typeof planWatchTick> => planWatchTick({ ...args, spends, thresholds: DEFAULT_THRESHOLDS.claude });

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
  { alias: "plan-three", pinned: true, storeDir: "/stores/three" },
];

const NOW = "2026-09-05T12:00:00.000Z";

/** Long enough ago that every store reads as due, so a test that cares about touching gets one. */
const STALE = "2026-09-04T12:00:00.000Z";

/** A swap recorded three hours before the tick — inside one access-token lifetime. */
const RECENT_SWAP = "2026-09-05T09:00:00.000Z";

/** A gauge built the way the real probe builds one: a header record parsed by `usage.ts`. */
function gauge({ alias, sevenDay = "0.10" }: { alias: string; sevenDay?: string }) {
  return unwrap(
    parseClaudeGauge({
      alias,
      headers: {
        "anthropic-ratelimit-unified-5h-reset": "1788459000",
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": "0.10",
        "anthropic-ratelimit-unified-7d-reset": "1789041600",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": sevenDay,
      },
      observedAtIso: NOW,
    }),
  );
}

const ALL_TOUCHED_LONG_AGO = ACCOUNTS.map((account) => ({ alias: account.alias, lastTouchedIso: STALE }));

describe("planWatchTick — the plan allowance the owner set on the active plan", () => {
  it("recommends off an active plan at the usage limit the owner set on it, read from accounts.json", () => {
    const plan = planTick({
      accounts: [{ alias: "plan-one", storeDir: "/stores/one", usageLimitPercent: 30 }, ...ACCOUNTS.slice(1)],
      identities: [],
      gauges: [gauge({ alias: "plan-one", sevenDay: "0.30" }), gauge({ alias: "plan-two" })],
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
    expect(plan.why).toBe(
      "RECOMMENDING plan-two as the plan to boot against — seven_day usage limit of 30% reached the rotation threshold before a wall",
    );
  });

  it("recommends off an active monthly-spend plan with no fresh spend reading, naming why", () => {
    const plan = planTick({
      accounts: [
        { alias: "plan-one", allowance: { kind: "monthly-spend" }, storeDir: "/stores/one" },
        ...ACCOUNTS.slice(1),
      ],
      identities: [],
      gauges: [gauge({ alias: "plan-two" })],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      spends: [{ alias: "plan-one", verdict: { kind: "not-measured", reason: "no spend reading recorded" } }],
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect(plan.rotateTo).toBe("plan-two");
    expect(plan.why).toBe(
      "RECOMMENDING plan-two as the plan to boot against — monthly spend not-measured (no spend reading recorded) moved the fleet before a wall",
    );
  });

  it("holds an active monthly-spend plan under its limit while no weekly plan is eligible", () => {
    const plan = planTick({
      accounts: [
        { alias: "plan-one", allowance: { kind: "monthly-spend" }, storeDir: "/stores/one" },
        ...ACCOUNTS.slice(1),
      ],
      identities: [],
      gauges: [gauge({ alias: "plan-two", sevenDay: "0.99" })],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      spends: [
        {
          alias: "plan-one",
          verdict: { currency: "USD", headroomMinor: 6000, kind: "open", reason: "$40 of $100", usedFraction: 0.4 },
        },
      ],
      state: selectAccount({
        alias: "plan-one",
        nowIso: RECENT_SWAP,
        reason: "under test",
        state: EMPTY_ROTATION_STATE,
      }),
      touches: ALL_TOUCHED_LONG_AGO,
    });
    expect([plan.rotateTo, plan.why]).toStrictEqual([
      undefined,
      "the active plan is under its monthly usage limit: $40 of $100",
    ]);
  });
});
