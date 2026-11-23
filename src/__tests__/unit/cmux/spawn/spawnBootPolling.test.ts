/** {@link spawnCmuxSession}'s boot poll: bounded, stopping on the first real change, and no pickup without one. */
import { describe, expect, it } from "vitest";

import { MAX_CLAUDE_LIMIT_POLLS } from "../../../../cmux/pickupDelivery.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { MAX_BOOT_POLLS } from "../../../../cmux/spawnPolling.js";
import { fakeClient } from "./fakeClient.js";
import { bootLinesOnly, deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("never sends the pickup command when the screen shows no visible change after boot", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "$ "] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    expect(bootLinesOnly({ calls })).toEqual({ bootLines: 2, pickups: 0 });
  });

  it("polls a bounded number of times rather than waiting for a boot that never comes", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "$ "] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    // Per tab, the `before` read plus exactly MAX_BOOT_POLLS poll reads — and a failed claude boot gets one more tab.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(2 * (1 + MAX_BOOT_POLLS));
  });

  it("stops polling the first tick a real change appears, not after every remaining tick", async () => {
    const { calls, client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n❯ ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    // before + one boot-poll tick + one readiness tick + one send-verify tick — each stage stops the moment
    // its condition is met — then the claude limit-banner poll, which has no condition to stop early on.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(4 + MAX_CLAUDE_LIMIT_POLLS);
  });
});
