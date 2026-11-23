import { describe, expect, it } from "vitest";

import { planAskSession, type VisibleSessionPlan } from "../../../cmux/plan.js";
import { composeWorkspaceDescription } from "../../../cmux/workspaceDescription.js";

/**
 * A real ask plan, built by the planner, whose title is the question and so does not contain its id.
 *
 * @returns the plan
 */
function askPlan({ respondingToHandle }: { respondingToHandle: string | undefined }): VisibleSessionPlan {
  return planAskSession({
    askChannel: "C0ALPHA",
    askMessageTs: "1700000000.000100",
    askQuestion: "why did the staging pool exhaust",
    branch: "main",
    host: "claude-code",
    model: "opus",
    pickupCommand: "/slopweaver:loop-bot",
    repoRoot: "/repo",
    respondingToHandle,
    spawnedAt: "2026-10-13T00:00:00.000Z",
  });
}

describe("composeWorkspaceDescription", () => {
  it("names a spawned session, its addressing id and who it answers, in that order", () => {
    const plan = askPlan({ respondingToHandle: "@bravo" });
    expect(plan.workspaceTitle.includes(plan.workspaceName)).toBe(false);
    expect(composeWorkspaceDescription({ plan })).toBe(`spawned session · ${plan.workspaceName} · for @bravo`);
  });

  it("drops the id when the title already carries it", () => {
    const base = askPlan({ respondingToHandle: "@bravo" });
    const plan = { ...base, workspaceTitle: `${base.workspaceName} handover` };
    expect(composeWorkspaceDescription({ plan })).toBe("spawned session · for @bravo");
  });

  it("omits the spawned-session part for a standing role", () => {
    const plan = { ...askPlan({ respondingToHandle: "@bravo" }), role: "bot" as const };
    expect(composeWorkspaceDescription({ plan })).toBe(`${plan.workspaceName} · for @bravo`);
  });

  it("omits the answering part when there is no addressed user", () => {
    const plan = askPlan({ respondingToHandle: undefined });
    expect(composeWorkspaceDescription({ plan })).toBe(`spawned session · ${plan.workspaceName}`);
  });

  it("answers undefined for a standing role whose title carries its id and which answers nobody", () => {
    const base = askPlan({ respondingToHandle: undefined });
    const plan = { ...base, role: "supervisor" as const, workspaceTitle: `chair ${base.workspaceName}` };
    expect(composeWorkspaceDescription({ plan })).toBe(undefined);
  });

  it("reads an explicit undefined role as a spawned session", () => {
    const plan = { ...askPlan({ respondingToHandle: undefined }), role: undefined };
    expect(composeWorkspaceDescription({ plan })).toBe(`spawned session · ${plan.workspaceName}`);
  });

  it("reads the explicit session role the same way", () => {
    const plan = { ...askPlan({ respondingToHandle: undefined }), role: "session" as const };
    expect(composeWorkspaceDescription({ plan })).toBe(`spawned session · ${plan.workspaceName}`);
  });
});
