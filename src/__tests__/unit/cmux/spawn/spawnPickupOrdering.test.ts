/** {@link spawnCmuxSession} sends the pickup only after a verified boot, resolving the latest command just before. */
import { describe, expect, it } from "vitest";

import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { err, ok } from "../../../../lib/result.js";
import { CREATED, fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("sends the pickup command only after boot is verified to have changed the screen", async () => {
    const { calls, client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n> ${PLAN.pickupCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
    const sends = calls.filter((call) => call.op === "sendLine");
    expect(sends.length).toBe(2);
    expect(sends[1]!.text).toBe(PLAN.pickupCommand);
  });

  it("resolves the latest pickup command after boot and immediately before send", async () => {
    const latestCommand = "slopweaver handover resume a-doc";
    const staleCommand = "slopweaver handover start a-doc";
    const { calls, client } = fakeClient({
      screens: ["$ ", "Claude Code v2.1.231 booting…", `Claude Code v2.1.231 booting…\n> ${latestCommand}`],
    });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({
      deps: spawnDeps,
      plan: { ...PLAN, pickupCommand: staleCommand },
      resolvePickup: () =>
        ok(calls.filter((call) => call.op === "readScreen").length >= 2 ? latestCommand : staleCommand),
    });

    expect(outcome).toEqual(
      ok({
        bootWitness: { by: "screen", confirmed: true },
        delivery: { kind: "witnessed", witness: { by: "screen", confirmed: true } },
        pickupCommand: latestCommand,
        ...CREATED,
      }),
    );
    const sends = calls.filter((call) => call.op === "sendLine");
    expect(sends[1]!.text).toBe(latestCommand);
  });

  it("refuses without sending pickup when the latest command cannot be resolved", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({
      deps: spawnDeps,
      plan: PLAN,
      resolvePickup: () => err("the run journal became unreadable"),
    });

    expect(outcome).toEqual(
      err({
        reason: "the run journal became unreadable",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace-1",
        workspaceRef: "workspace:1",
      }),
    );
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(1);
  });
});
