/** The Codex browser door: asked once the worktree exists, before any workspace, about the routed plan. */
import { describe, expect, it } from "vitest";

import { bootCmuxWorkspace, type SpawnDeps } from "../../../../cmux/spawn.js";
import { err, ok, unwrapErr } from "../../../../lib/result.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("the Codex browser door", () => {
  // After the worktree, never before: a fresh worktree's own branch can carry a trusted .codex/config.toml the
  // checkout it is cut from does not, and the seat loads the worktree's (Codex review r4).
  it("refuses once the worktree exists and before any workspace, carrying the door's own refusal", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "OpenAI Codex (v0.155.1)"] });
    const { deps: passing } = deps({ client });
    const order: string[] = [];
    const refusing: SpawnDeps = {
      ...passing,
      ensureWorktree: () => {
        order.push("worktree");
      },
      gateCodexBrowserSurface: () => {
        order.push("door");
        return err("a visible Codex seat boot blocked because cua_repl would start");
      },
    };

    const outcome = await bootCmuxWorkspace({
      deps: refusing,
      plan: { ...PLAN, host: "codex", worktreeExists: false },
    });

    expect(unwrapErr(outcome).reason).toBe("a visible Codex seat boot blocked because cua_repl would start");
    expect(unwrapErr(outcome).workspaceRef).toBe("");
    expect(order).toEqual(["worktree", "door"]);
    expect(calls.filter((call) => call.op === "createWorkspace").length).toBe(0);
  });

  it("is asked about the plan the credential gate returned, not the one it was handed", async () => {
    const { client } = fakeClient({ screens: ["$ ", "OpenAI Codex (v0.155.1)"] });
    const { deps: passing } = deps({ client });
    const asked: string[] = [];
    const recording: SpawnDeps = {
      ...passing,
      gateCodexBrowserSurface: ({ plan }) => {
        asked.push(String(plan.codexHome));
        return ok(undefined);
      },
      gateCredentialStore: ({ plan }) => Promise.resolve(ok({ ...plan, codexHome: "/state/plan-six/.codex" })),
    };

    await bootCmuxWorkspace({ deps: recording, plan: { ...PLAN, host: "codex" } });

    expect(asked).toEqual(["/state/plan-six/.codex"]);
  });
});
