/** {@link bootCmuxWorkspace}'s create call and the sidebar row it publishes before the boot line is sent. */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../../cmux/errors.js";
import type { SpawnPlan } from "../../../../cmux/plan.js";
import { bootCmuxWorkspace, type SpawnDeps } from "../../../../cmux/spawn.js";
import { err } from "../../../../lib/result.js";
import { CREATED, fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

// deleted-with-code: openingChecklist

describe("bootCmuxWorkspace", () => {
  it("creates the workspace with the plan's title as --name, and a --description carrying only what the title cannot", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });
    const plan: SpawnPlan = {
      ...PLAN,
      respondingToHandle: "@ada",
      spawnedAt: "2026-08-17T09:30:00.000Z",
      workspaceName: "ask-C1-2.2",
      workspaceTitle: "why did the staging pool exhaust?",
    };

    await bootCmuxWorkspace({ deps: spawnDeps, plan });

    const create = calls.find((call) => call.op === "createWorkspace")!;
    expect(create.name).toBe("why did the staging pool exhaust?");
    expect(create.description).toBe("spawned session · ask-C1-2.2 · for @ada");
  });

  it("says only that the row is a spawned session when the title already carries the raw id", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    await bootCmuxWorkspace({
      deps: spawnDeps,
      plan: { ...PLAN, workspaceName: "a-doc", workspaceTitle: "a-doc handover" },
    });

    const create = calls.find((call) => call.op === "createWorkspace")!;
    expect(create.description).toBe("spawned session");
  });

  /** A tinted row already says it is always on, so repeating it here is the duplication that got the old line cut. */
  it("omits the description entirely on a standing surface, whose colour already says what this would", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    await bootCmuxWorkspace({
      deps: spawnDeps,
      plan: { ...PLAN, role: "scheduler", workspaceName: "a-doc", workspaceTitle: "a-doc handover" },
    });

    const create = calls.find((call) => call.op === "createWorkspace")!;
    expect(create.description).toBeUndefined();
  });

  it("keeps the raw id when the title does not contain it, and drops the spawn timestamp either way", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });

    await bootCmuxWorkspace({
      deps: spawnDeps,
      plan: {
        ...PLAN,
        spawnedAt: "2026-08-17T09:30:00.000Z",
        workspaceName: "review-C1-2.2",
        workspaceTitle: "reviewing the staging pool answer",
      },
    });

    const create = calls.find((call) => call.op === "createWorkspace")!;
    expect(create.description).toBe("spawned session · review-C1-2.2");
  });

  it("publishes the row's title, colour and ref pill to the NEW workspace by id — never a checklist or a lane pin", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps, sidebarCalls } = deps({ client });

    await bootCmuxWorkspace({ deps: spawnDeps, plan: PLAN });

    expect(calls.findIndex((call) => call.op === "sendLine")).toBeGreaterThan(0);
    expect(sidebarCalls).toEqual([
      ["workspace", "list", "--json"],
      ["workspace-action", "--action", "rename", "--title", "a-doc", "--workspace", CREATED.workspaceId],
      ["workspace-action", "--action", "clear-color", "--workspace", CREATED.workspaceId],
      [
        "set-status",
        "ws",
        CREATED.workspaceRef,
        "--icon",
        "number",
        "--priority",
        "100",
        "--workspace",
        CREATED.workspaceId,
      ],
    ]);
  });

  it("boots anyway when the sidebar publish fails — the row is a decoration, the session is the work", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });
    const failing: SpawnDeps = {
      ...spawnDeps,
      sidebarCli: {
        run: () => err(CmuxErrors.callFailed({ cmuxCode: "cli_failed", message: "cmux exited 1", method: "cmux" })),
      },
    };

    const outcome = await bootCmuxWorkspace({ deps: failing, plan: PLAN });

    expect(outcome.isOk()).toBe(true);
  });
});
