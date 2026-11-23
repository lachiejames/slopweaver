/** {@link spawnCmuxSession} on an empty or unreadable screen: a baseline, or an unverified boot, never a crash. */
import { describe, expect, it } from "vitest";

import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { fakeClient, UNREADABLE } from "./fakeClient.js";
import { bootLinesOnly, deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("never sends the pickup command when the post-boot screen is empty", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", ""] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    expect(bootLinesOnly({ calls })).toEqual({ bootLines: 2, pickups: 0 });
  });

  it("treats a read-screen failure on the just-created surface as an empty baseline, not a crash", async () => {
    // Measured live: `cmux read-screen` throws outright on a surface still settling from `workspace create`.
    const { client } = fakeClient({
      screens: [UNREADABLE, "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n> ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
  });

  it("treats a read-screen failure after boot as boot-not-verified, never as a crash", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", UNREADABLE] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    expect(bootLinesOnly({ calls })).toEqual({ bootLines: 2, pickups: 0 });
  });
});
