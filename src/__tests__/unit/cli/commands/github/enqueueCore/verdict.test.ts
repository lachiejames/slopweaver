/* The enqueue door's verdict: proceed, refuse or already done, for an enqueue, a dry run and a dequeue. */
import { describe, expect, it } from "vitest";

import { enqueueVerdict } from "../../../../../../cli/commands/github/enqueueCore.js";
import { args, ORDINARY, PAIRED, pr, QUEUE } from "./fixtures.js";

describe("enqueueVerdict", () => {
  it("proceeds on a clean pull request", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args(),
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("proceed");
    expect(verdict.lines.at(-1)).toBe("verdict: nothing stands unacknowledged — pressing 'Merge when ready' now.");
  });

  it("names the dry run in its closing line rather than promising a write", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args({ dryRun: true }),
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("proceed");
    expect(verdict.lines.at(-1)).toContain("only REPORTS — drop --dry-run");
  });

  it("refuses on a hard refusal, and never reaches the findings", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args(),
      pr: pr({ isDraft: true }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("refused");
    expect(verdict.lines.at(-1)).toContain("refused: #9 is still a DRAFT");
  });

  it("refuses while a finding stands unacknowledged", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args(),
      pr: pr({ mergeable: "CONFLICTING" }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("refused");
    expect(verdict.lines.at(-1)).toContain("REFUSED — 1 finding(s) unacknowledged");
  });

  it("proceeds once the finding is acknowledged by subject", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args({ acknowledge: ["not-mergeable"] }),
      pr: pr({ mergeable: "CONFLICTING" }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("proceed");
  });

  it("prints the stated reason verbatim under --acknowledge-all", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args({ acknowledgeAll: true, reason: "sole codeowner is the sole author" }),
      pr: pr({ reviewDecision: "REVIEW_REQUIRED" }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("proceed");
    expect(verdict.lines).toContain("acknowledged ALL findings above — reason: sole codeowner is the sole author");
  });

  it("reports an already-queued pull request as neither a refusal nor a write", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args(),
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 4, state: "QUEUED" } }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("already");
    expect(verdict.lines.at(-1)).toBe("#9 is ALREADY queued at position 4 (QUEUED) — nothing to press.");
  });

  it("lets --dequeue past every finding that would refuse an enqueue", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args({ dequeue: true }),
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
        entry: { estimatedSecondsToMerge: undefined, position: 1, state: "UNMERGEABLE" },
        mergeable: "CONFLICTING",
        reviewDecision: "REVIEW_REQUIRED",
      }),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("proceed");
    expect(verdict.lines.at(-1)).toBe("verdict: nothing stands unacknowledged — taking it back out of the queue now.");
  });

  it("reports a --dequeue with no entry as already done", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      requiredContexts: ["build"],
      args: args({ dequeue: true }),
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("already");
    expect(verdict.lines.at(-1)).toBe("#9 holds no queue entry — there is nothing to dequeue.");
  });
});
