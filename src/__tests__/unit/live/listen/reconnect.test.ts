/**
 * The reconnect schedule. The two properties worth pinning: Slack's routine rotation costs nothing (no
 * delay, no failure recorded), and an unexpected end backs off on an exact, deterministic schedule.
 */
import { describe, expect, it } from "vitest";

import {
  RECONNECT_BASE_MS,
  RECONNECT_MAX_FAILURES,
  RECONNECT_MAX_MS,
  type ReconnectPlan,
  reconnectDelayMs,
  reconnectPlan,
  SLACK_LINK_DISABLED,
} from "../../../../live/listen/reconnect.js";

/** Unwrap a stop plan's reason, throwing on any other arm — the `unwrap` idiom, so no test branches. */
function stopReason({ plan }: { plan: ReconnectPlan }): string {
  if (plan.kind !== "stop") {
    throw new Error(`expected a stop plan, got ${plan.kind}`);
  }
  return plan.why;
}

describe("reconnectPlan", () => {
  it("reconnects immediately on Slack's routine rotation warning, and does not count it as a failure", () => {
    expect(reconnectPlan({ consecutiveFailures: 0, reason: "warning" })).toEqual({
      delayMs: 0,
      expected: true,
      kind: "reconnect",
    });
  });

  it("treats refresh_requested the same way, even after failures have accumulated", () => {
    expect(reconnectPlan({ consecutiveFailures: 3, reason: "refresh_requested" })).toEqual({
      delayMs: 0,
      expected: true,
      kind: "reconnect",
    });
  });

  it("stops on link_disabled, because every reconnect would be refused", () => {
    expect(stopReason({ plan: reconnectPlan({ consecutiveFailures: 0, reason: SLACK_LINK_DISABLED }) })).toContain(
      "re-enable Socket Mode",
    );
  });

  it("backs off exponentially from the base delay on an unexpected end", () => {
    const plans = [0, 1, 2, 3].map((consecutiveFailures) =>
      reconnectPlan({ consecutiveFailures, reason: "socket-open-failed" }),
    );

    expect(plans).toEqual([
      { delayMs: RECONNECT_BASE_MS, expected: false, kind: "reconnect" },
      { delayMs: 2_000, expected: false, kind: "reconnect" },
      { delayMs: 4_000, expected: false, kind: "reconnect" },
      { delayMs: 8_000, expected: false, kind: "reconnect" },
    ]);
  });

  it("caps the delay so a listener keeps trying at a visible cadence", () => {
    expect(reconnectPlan({ consecutiveFailures: 7, reason: "ticket-open-failed" })).toEqual({
      delayMs: RECONNECT_MAX_MS,
      expected: false,
      kind: "reconnect",
    });
  });

  it("gives up loudly once the consecutive-failure budget is spent", () => {
    const plan = reconnectPlan({ consecutiveFailures: RECONNECT_MAX_FAILURES, reason: "ticket-open-failed" });

    expect(stopReason({ plan })).toContain("8 consecutive connections failed (last: ticket-open-failed)");
  });

  it("still stops on link_disabled before the failure budget is consulted", () => {
    expect(reconnectPlan({ consecutiveFailures: 99, reason: SLACK_LINK_DISABLED }).kind).toBe("stop");
  });
});

describe("reconnectDelayMs", () => {
  it("is the same capped schedule an unexpected end waits, and never stops past the failure budget", () => {
    const delays = [0, 1, 2, 3, 4, 5, RECONNECT_MAX_FAILURES, 99].map((consecutiveFailures) =>
      reconnectDelayMs({ consecutiveFailures }),
    );

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});
