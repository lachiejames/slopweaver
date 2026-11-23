/**
 * `workerModel` — the pin-the-model rule applied to an ask worker. Pure: a decision in, a model name out.
 */
import { describe, expect, it } from "vitest";

import type { RespondDecision } from "../../../../live/turn/tier.js";
import { DEFAULT_REVIEWER_MODEL, DEFAULT_WORKER_MODEL, pinnedWorkerModel } from "../../../../live/turn/workerModel.js";

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "needs a real investigation",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
};

describe("pinnedWorkerModel", () => {
  it("pins the explicit default when the decision named no model — never undefined, never the saved default", () => {
    expect(pinnedWorkerModel({ decision: DECISION })).toBe(DEFAULT_WORKER_MODEL);
    expect(DEFAULT_WORKER_MODEL).toBe("opus");
  });

  it("honours the judging session's own right-sizing when the decision named a model", () => {
    expect(pinnedWorkerModel({ decision: { ...DECISION, model: "sonnet" } })).toBe("sonnet");
  });

  it("keeps the reviewer on the same tier as the default worker — never right-sized below what it checks", () => {
    expect(DEFAULT_REVIEWER_MODEL).toBe(DEFAULT_WORKER_MODEL);
  });
});
