/** {@link spawnCmuxSession}'s codex boot line: the repository's model pin, and a routed `CODEX_HOME` prefix. */
import { describe, expect, it } from "vitest";

import type { SpawnPlan } from "../../../../cmux/plan.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { codexBrowserOffFlags } from "../../../../codex/browserSurface.js";
import { CODEX_MODEL } from "../../../../codex/profiles.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("sends the exact codex boot line, never claude, when the plan names the codex host", async () => {
    const { calls, client } = fakeClient({
      screens: [
        "$ ",
        "OpenAI Codex (v0.145.0) starting…",
        `OpenAI Codex (v0.145.0) starting…\n> ${PLAN.pickupCommand}`,
      ],
    });
    const { deps: spawnDeps } = deps({ client });
    const codexPlan: SpawnPlan = { ...PLAN, host: "codex" };

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: codexPlan });

    expect(outcome.isOk()).toBe(true);
    const bootSend = calls.find((call) => call.op === "sendLine");
    // No routed home on this plan, so no `CODEX_HOME=` prefix: an unrouted seat boots exactly as it did
    // before routing existed, plus the repository's own model pin.
    expect(bootSend!.text).toBe(
      `NX_DAEMON=false codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`,
    );
  });

  it("carries the routed CODEX_HOME as a prefix when the plan names one", async () => {
    const { calls, client } = fakeClient({
      screens: [
        "$ ",
        "OpenAI Codex (v0.145.0) starting…",
        `OpenAI Codex (v0.145.0) starting…\n> ${PLAN.pickupCommand}`,
      ],
    });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({
      deps: spawnDeps,
      plan: { ...PLAN, codexHome: "/state/plan-seven/.codex", host: "codex" },
    });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(
      `NX_DAEMON=false CODEX_HOME=/state/plan-seven/.codex codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`,
    );
  });
});
