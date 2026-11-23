/** {@link spawnCmuxSession} waits for a ready prompt only on a host whose prompt has been measured. */
import { describe, expect, it } from "vitest";

import { MAX_CLAUDE_LIMIT_POLLS, MAX_CODEX_QUOTA_POLLS } from "../../../../cmux/pickupDelivery.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("waits for a ready prompt before sending, and stops waiting the tick it sees one", async () => {
    const { calls, client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", "Claude Code v2.1.231", `❯ ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
    // before + boot tick + TWO readiness ticks (the first screen carries no prompt) + one send-verify tick
    // + the claude limit-banner poll.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(5 + MAX_CLAUDE_LIMIT_POLLS);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("spends no readiness ticks at all on a host whose ready prompt has never been measured", async () => {
    // `codex` is that host. Burning the bound on a signal nobody has captured would slow every codex spawn
    // for nothing, so the wait is skipped outright rather than timed out.
    const { calls, client } = fakeClient({
      screens: ["$ ", "OpenAI Codex (v0.145.0) starting…", `OpenAI Codex (v0.145.0)\n> ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: { ...PLAN, host: "codex" } });

    expect(outcome.isOk()).toBe(true);
    // before + boot tick + send-verify tick + MAX_CODEX_QUOTA_POLLS exhaustion reads — no readiness reads.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(3 + MAX_CODEX_QUOTA_POLLS);
  });
});
