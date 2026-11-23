/*
 * The watch naming a monthly-spend plan as the active one. Such a plan is never probed nor touched, so it is absent
 * from the tick's `accounts`; it reaches active-plan resolution through its spend verdict. Left out, deduction names
 * the one unidentified weekly plan the slot does not hold, and a closed monthly plan is held instead of left.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeStoreIdentity } from "../../../claude/checkoutIdentity.js";
import type { ClaudeAccount, ClaudePlanSpend } from "../../../claude/contracts.js";
import { EMPTY_ROTATION_STATE } from "../../../claude/rotationState.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { unwrap } from "../../../lib/result.js";
import { planWatchTick } from "./defaultThresholds.js";

const NOW = "2026-11-05T00:00:00.000Z";

/** Two weekly plans, both identified, so neither is a candidate for the slot's unknown account. */
const WEEKLY: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
];

const IDENTIFIED: readonly ClaudeStoreIdentity[] = [
  { alias: "plan-one", observedAtIso: NOW, organizationId: "org-aaa" },
  { alias: "plan-two", observedAtIso: NOW, organizationId: "org-bbb" },
];

/** A healthy weekly gauge, parsed from real headers at the tick. */
function gauge({ alias }: { alias: string }) {
  return unwrap(
    parseClaudeGauge({
      alias,
      headers: {
        "anthropic-ratelimit-unified-5h-reset": "1793858400",
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-utilization": "0.10",
        "anthropic-ratelimit-unified-7d-reset": "1794268800",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": "0.10",
      },
      observedAtIso: NOW,
    }),
  );
}

const AT_LIMIT: ClaudePlanSpend = {
  alias: "plan-m",
  verdict: { kind: "usage-limit", reason: "50.00 USD spent of 100.00 USD this month, at its usage limit" },
};

describe("planWatchTick — a monthly-spend plan as the active one", () => {
  it("deduces the unidentified monthly plan as the slot's account, and rotates off it at its usage limit", () => {
    const plan = planWatchTick({
      accounts: WEEKLY,
      activeOrganizationId: "org-mmm",
      gauges: [gauge({ alias: "plan-one" }), gauge({ alias: "plan-two" })],
      identities: IDENTIFIED,
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      spends: [AT_LIMIT],
      state: EMPTY_ROTATION_STATE,
      touches: [],
    });
    expect([plan.active, plan.activeFrom, plan.outcome.act, plan.rotateTo]).toEqual([
      "plan-m",
      "deduced",
      "rotate",
      "plan-one",
    ]);
  });

  it("deduces nothing when a weekly plan is unidentified beside it, rather than naming the weekly one", () => {
    const plan = planWatchTick({
      accounts: WEEKLY,
      activeOrganizationId: "org-mmm",
      gauges: [gauge({ alias: "plan-one" }), gauge({ alias: "plan-two" })],
      identities: [IDENTIFIED[0]!],
      nowIso: NOW,
      seat: "worker",
      sharesActiveCredential: [],
      spends: [AT_LIMIT],
      state: EMPTY_ROTATION_STATE,
      touches: [],
    });
    expect([plan.active, plan.activeFrom]).toEqual([undefined, "unknown"]);
  });
});
