/**
 * A watch tick judges the active plan by the install's thresholds, never by a bar fixed in code: the same 80% week
 * holds under the default route bar and recommends moving once the register lowers it.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { EMPTY_ROTATION_STATE, selectAccount } from "../../../claude/rotationState.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { planWatchTick } from "../../../claude/watchTick.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
];

const NOW = "2026-09-05T12:00:00.000Z";

/** A gauge built the way the real probe builds one: a header record parsed by `usage.ts`. */
function gauge({ alias, sevenDay }: { alias: string; sevenDay: string }) {
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

const INPUT = {
  accounts: ACCOUNTS,
  gauges: [gauge({ alias: "plan-one", sevenDay: "0.80" }), gauge({ alias: "plan-two", sevenDay: "0.10" })],
  identities: [],
  nowIso: NOW,
  seat: "worker",
  sharesActiveCredential: [],
  state: selectAccount({
    alias: "plan-one",
    nowIso: "2026-09-05T09:00:00.000Z",
    reason: "under test",
    state: EMPTY_ROTATION_STATE,
  }),
  touches: [],
} as const;

describe("planWatchTick thresholds", () => {
  it("holds an active plan at 80% under the default route bar", () => {
    const plan = planWatchTick({ ...INPUT, spends: [], thresholds: DEFAULT_THRESHOLDS.claude });
    expect(plan.rotateTo).toBeUndefined();
  });

  it("recommends the other plan once the install's route bar is lowered to 0.7", () => {
    const plan = planWatchTick({ ...INPUT, spends: [], thresholds: { ...DEFAULT_THRESHOLDS.claude, routeAt: 0.7 } });
    expect(plan.rotateTo).toBe("plan-two");
  });
});
