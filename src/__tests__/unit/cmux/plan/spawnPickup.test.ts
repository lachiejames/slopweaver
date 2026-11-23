/*
 * `planSpawn`'s boot: the pickup command a handover spawn is sent, its driver, model and workspace title, and the
 * sidebar checklist it no longer carries.
 */
import { describe, expect, it } from "vitest";

import { WAIT_RULE_INSTRUCTION } from "../../../../cmux/pickupCommand.js";
import { planSpawn } from "../../../../cmux/plan.js";
import { DOC_PATH, REPO_ROOT } from "./harness.js";

describe("planSpawn", () => {
  it("sends the pickup template, never the slash command the doc's own pickup section names", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.pickupCommand).toBe(
      `Read ${DOC_PATH} end to end, then run: slopweaver handover start a-doc, then execute the doc. ` +
        `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
    expect(plan.pickupCommand.includes("/slopweaver:")).toBe(false);
  });

  it("defaults the driver to claude when none is named", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.driver).toBe("claude");
    expect(plan.host).toBe("claude-code");
  });

  it("carries a named codex driver through, and resolves the pickup command for it", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      driver: "codex",
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.driver).toBe("codex");
    expect(plan.host).toBe("codex");
    expect(plan.pickupCommand).toBe(
      `Read ${DOC_PATH} end to end, then run: slopweaver handover start a-doc, then execute the doc. ` +
        `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
  });

  it("plans start for a new handover and resume for one whose journal is open", () => {
    const newPlan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      driver: "codex",
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });
    const resumedPlan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      driver: "codex",
      repoRoot: REPO_ROOT,
      runEvents: [
        {
          atIso: "2026-08-14T00:00:00.000Z",
          branch: "a-doc",
          docHash: "abc123",
          kind: "started",
        },
      ],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(newPlan.pickupCommand).toBe(
      `Read ${DOC_PATH} end to end, then run: slopweaver handover start a-doc, then execute the doc. ` +
        `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
    expect(resumedPlan.pickupCommand).toBe(
      `Read ${DOC_PATH} end to end, then run: slopweaver handover resume a-doc, then execute the doc. ` +
        `It is complete; do not re-plan or ask what it covers. ${WAIT_RULE_INSTRUCTION}`,
    );
  });

  it("leaves model undefined when the caller passes none", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.model).toBeUndefined();
  });

  it("carries the caller's named model through unchanged", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      model: "sonnet",
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.model).toBe("sonnet");
  });

  it("uses the slug as the workspace title, distinct from an ask's derived one", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.workspaceTitle).toBe("a-doc");
    expect(plan.respondingToHandle).toBeUndefined();
    expect(plan.spawnedAt).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("planSpawn carries no sidebar checklist", () => {
  it("plans no opening checklist for the workspace's sidebar", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-23T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(Object.keys(plan).includes("openingChecklist")).toBe(false);
  });
});
