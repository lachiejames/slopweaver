/**
 * `subagent.ts` is a pure type contract — no exported function to call. What is checkable here is that the
 * shapes actually compile the way the module's own doc claims: an `ExecutionEvidence` carries only labelled
 * observations, never a free-form recommendation field, and a `ReadOnlySubagentAdapter` is a plain injected
 * function a test can satisfy with a fake, exactly like `RoutingJudgement`.
 */
import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { ExecutionEvidence, ReadOnlySubagentAdapter, ReadOnlyTask } from "../../../../live/turn/subagent.js";

const ASK: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };

describe("ExecutionEvidence", () => {
  it("carries one labelled observation per fact, author and source both required", () => {
    const evidence: ExecutionEvidence = {
      observations: [
        { author: "owner", source: "thread", text: "the owner said the fix is already merged" },
        { author: "system", source: "github-issue-42", text: "issue #42 is closed" },
      ],
    };

    expect(evidence.observations).toHaveLength(2);
    expect(evidence.observations[0]!.author).toBe("owner");
    expect(evidence.observations[1]!.source).toBe("github-issue-42");
  });

  it("is satisfied by zero observations — an investigation that found nothing is still a valid result", () => {
    const evidence: ExecutionEvidence = { observations: [] };
    expect(evidence.observations).toEqual([]);
  });
});

describe("ReadOnlySubagentAdapter", () => {
  it("is satisfiable by a plain fake returning evidence, no model call involved", async () => {
    const task: ReadOnlyTask = { ask: ASK, instructions: "read the linked issue" };
    const adapter: ReadOnlySubagentAdapter = (received) =>
      Promise.resolve({
        evidence: {
          observations: [{ author: "system", source: "fake", text: `investigated: ${received.instructions}` }],
        },
        kind: "returned",
      });

    const outcome = await adapter(task);

    expect(outcome).toEqual({
      evidence: { observations: [{ author: "system", source: "fake", text: "investigated: read the linked issue" }] },
      kind: "returned",
    });
  });

  it("is satisfiable by a plain fake reporting failure", async () => {
    const adapter: ReadOnlySubagentAdapter = () =>
      Promise.resolve({ kind: "failed", reason: "blocked on credentials" });

    const outcome = await adapter({ ask: ASK, instructions: "anything" });

    expect(outcome).toEqual({ kind: "failed", reason: "blocked on credentials" });
  });
});
