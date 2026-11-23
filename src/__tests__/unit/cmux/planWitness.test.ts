import { describe, expect, it } from "vitest";

import { planAskSession, planReviewSession } from "../../../cmux/plan.js";
import { planWitnessSession } from "../../../cmux/planWitness.js";

const REPO_ROOT = "/repo/checkout";

const BASE_ARGS = {
  branch: "a-branch",
  channel: "C1",
  host: "claude-code" as const,
  messageTs: "2.2",
  model: "sonnet",
  pickupCommand: "slopweaver witness resume w-0123456789abcdef",
  repoRoot: REPO_ROOT,
  spawnedAt: "2026-10-05T00:00:00.000Z",
  text: "the deploy finished cleanly",
};

describe("planWitnessSession", () => {
  it("names the workspace and session under a witness- prefix, titled by the witnessed claim", () => {
    const plan = planWitnessSession(BASE_ARGS);

    expect(plan.workspaceName).toBe("witness-C1-2.2");
    expect(plan.sessionName).toBe("witness-C1-2.2");
    expect(plan.workspaceTitle).toBe("witness: the deploy finished cleanly");
  });

  it("boots the bot template into the current checkout, addressed to nobody, with the exact pickup", () => {
    const plan = planWitnessSession(BASE_ARGS);

    expect(plan.template).toBe("bot");
    expect(plan.cwd).toBe(REPO_ROOT);
    expect(plan.worktreeExists).toBe(true);
    expect(plan.respondingToHandle).toBeUndefined();
    expect(plan.pickupCommand).toBe("slopweaver witness resume w-0123456789abcdef");
    expect(plan.model).toBe("sonnet");
    expect(plan.driver).toBe("claude");
  });

  it("derives the codex driver from a codex host, and carries effort only when one is pinned", () => {
    expect(planWitnessSession({ ...BASE_ARGS, host: "codex" }).driver).toBe("codex");
    expect(planWitnessSession({ ...BASE_ARGS, effort: "high" }).effort).toBe("high");
    expect(Object.keys(planWitnessSession(BASE_ARGS))).not.toContain("effort");
  });

  it("never answers to the ask worker's or reviewer's name for the same message", () => {
    const shared = { ...BASE_ARGS, askChannel: "C1", askMessageTs: "2.2", askQuestion: BASE_ARGS.text };
    const names = [
      planWitnessSession(BASE_ARGS).sessionName,
      planAskSession({ ...shared, respondingToHandle: undefined }).sessionName,
      planReviewSession(shared).sessionName,
    ];

    expect(names).toEqual(["witness-C1-2.2", "ask-C1-2.2", "review-C1-2.2"]);
  });
});
