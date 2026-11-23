/*
 * `planAskSession`, `planDrawdownInvestigation` and `planReviewSession`: the plans for a Slack ask's worker, a drawdown
 * investigation and an answer reviewer, from inputs already read.
 */
import { describe, expect, it } from "vitest";

import { bootLine } from "../../../../cmux/bootLine.js";
import { opusSpawnEffort } from "../../../../cmux/modelPin.js";
import { planAskSession, planDrawdownInvestigation, planReviewSession } from "../../../../cmux/plan.js";
import { REPO_ROOT } from "./harness.js";

describe("planAskSession", () => {
  const BASE_ARGS = {
    askChannel: "C1",
    askMessageTs: "2.2",
    askQuestion: "why did the staging pool exhaust?",
    branch: "a-branch",
    host: "claude-code" as const,
    model: "opus",
    pickupCommand: "Read the brief and answer it.",
    repoRoot: REPO_ROOT,
    respondingToHandle: "@ada",
    spawnedAt: "2026-08-17T00:00:00.000Z",
  };

  it("keeps the raw channel/messageTs id as workspaceName, unrelated to the derived title", () => {
    const plan = planAskSession(BASE_ARGS);

    expect(plan.workspaceName).toBe("ask-C1-2.2");
    expect(plan.workspaceTitle).toBe("why did the staging pool exhaust?");
  });

  it("carries spawnedAt and the resolved respondingToHandle straight through", () => {
    const plan = planAskSession(BASE_ARGS);

    expect(plan.spawnedAt).toBe("2026-08-17T00:00:00.000Z");
    expect(plan.respondingToHandle).toBe("@ada");
  });

  it("leaves respondingToHandle undefined when the caller resolved none", () => {
    const plan = planAskSession({ ...BASE_ARGS, respondingToHandle: undefined });

    expect(plan.respondingToHandle).toBeUndefined();
  });

  it("pins the model the caller named — never leaves the boot line to the saved default", () => {
    const plan = planAskSession({ ...BASE_ARGS, model: "sonnet" });

    expect(plan.model).toBe("sonnet");
  });

  it("names the harness session after the ask, so ListAgents can tell it from the listener it shares a checkout with", () => {
    const plan = planAskSession(BASE_ARGS);

    expect(plan.sessionName).toBe("ask-C1-2.2");
  });

  it("boots an Opus worker at --effort high, so the saved default cannot leave it at medium", () => {
    const plan = planAskSession({ ...BASE_ARGS, effort: opusSpawnEffort({ host: "claude-code", model: "opus" })! });

    expect(plan.effort).toBe("high");
    expect(bootLine({ deps: { resolvePluginDir: () => undefined }, plan })).toBe(
      "claude --model opus --effort high --name ask-C1-2.2 --settings " +
        `"{\\"claudeMdExcludes\\":[\\"$PWD/.claude/rules/typescript-patterns.md\\",` +
        `\\"$PWD/.claude/rules/testing.md\\",\\"$PWD/.claude/rules/error-handling.md\\"]}"`,
    );
  });

  it("boots a Slack ask worker from the bot template, which leaves the code rules out", () => {
    expect(planAskSession(BASE_ARGS).template).toBe("bot");
  });

  it("carries no effort key at all when the caller pinned none", () => {
    const plan = planAskSession({ ...BASE_ARGS, model: "sonnet" });

    expect(Object.keys(plan)).not.toContain("effort");
  });
});

describe("planDrawdownInvestigation", () => {
  const BASE_ARGS = {
    branch: "a-branch",
    incidentId: "inc-1",
    model: "opus",
    pickupCommand: "Look into the spike.",
    repoRoot: REPO_ROOT,
    spawnedAt: "2026-08-17T00:00:00.000Z",
  };

  it("carries the effort it was given onto the plan the boot line reads", () => {
    const plan = planDrawdownInvestigation({ ...BASE_ARGS, effort: "high" });

    expect(plan.effort).toBe("high");
    expect(plan.model).toBe("opus");
  });

  it("boots an investigation from the research template", () => {
    expect(planDrawdownInvestigation(BASE_ARGS).template).toBe("research");
  });

  it("carries no effort key when none was given", () => {
    expect(Object.keys(planDrawdownInvestigation(BASE_ARGS))).not.toContain("effort");
  });
});

describe("planReviewSession", () => {
  const BASE_ARGS = {
    askChannel: "C1",
    askMessageTs: "2.2",
    askQuestion: "why did the staging pool exhaust?",
    branch: "a-branch",
    host: "claude-code" as const,
    model: "opus",
    pickupCommand: "Read the packet and write the verdict.",
    repoRoot: REPO_ROOT,
    spawnedAt: "2026-08-17T00:00:00.000Z",
  };

  it("boots an answer reviewer from the bot template", () => {
    expect(planReviewSession(BASE_ARGS).template).toBe("bot");
  });

  it("names the workspace after the ask under a review- prefix, so it never collides with the worker's", () => {
    const plan = planReviewSession(BASE_ARGS);

    expect(plan.workspaceName).toBe("review-C1-2.2");
    expect(plan.workspaceTitle).toBe("review: why did the staging pool exhaust?");
  });

  it("boots into the current checkout with no worktree, no addressed user, and the pinned model", () => {
    const plan = planReviewSession(BASE_ARGS);

    expect(plan.cwd).toBe(REPO_ROOT);
    expect(plan.worktreeExists).toBe(true);
    expect(plan.respondingToHandle).toBeUndefined();
    expect(plan.model).toBe("opus");
    expect(plan.driver).toBe("claude");
  });

  it("derives the codex driver from a codex host", () => {
    const plan = planReviewSession({ ...BASE_ARGS, host: "codex" });

    expect(plan.driver).toBe("codex");
    expect(plan.host).toBe("codex");
  });

  it("carries the reviewer's effort when one is pinned, and no key when none is", () => {
    expect(planReviewSession({ ...BASE_ARGS, effort: "high" }).effort).toBe("high");
    expect(Object.keys(planReviewSession(BASE_ARGS))).not.toContain("effort");
  });

  it("gives the reviewer a session name the worker for the SAME ask can never answer to", () => {
    const reviewer = planReviewSession(BASE_ARGS);
    const worker = planAskSession({ ...BASE_ARGS, respondingToHandle: "@ada" });

    expect(reviewer.sessionName).toBe("review-C1-2.2");
    expect(worker.sessionName).toBe("ask-C1-2.2");
  });
});
