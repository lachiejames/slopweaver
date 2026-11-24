/*
 * A merge queue that gates on no status-check context, followed through every function that has to see it:
 * the hard refusal, acknowledgement immunity, the dequeue bypass and the identity lines.
 */
import { describe, expect, it } from "vitest";

import { enqueueIdentityLines, enqueueVerdict } from "../../../../../../cli/commands/github/enqueueCore.js";
import { enqueueRefusals } from "../../../../../../cli/commands/github/enqueueFindings.js";
import { args, ORDINARY, PAIRED, PASSING, pr, QUEUE } from "./fixtures.js";

describe("enqueueRefusals on an ungated queue", () => {
  it("refuses a queue that requires no status-check contexts at all", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: [],
    });
    expect(refusals).toEqual([
      "acme/widget's queue on main requires NO status-check contexts, so it would merge this pull request on " +
        "arrival without testing the merged result. Tick 'Require status checks to pass before merging' on main " +
        "and name the contexts the queue must wait for, or land it with `slopweaver github merge --repo " +
        "acme/widget --base origin/main --head feature --description - --admin --number 9 < body.md` instead.",
    ]);
  });

  it("raises nothing when the queue requires even one context", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: ["build"],
    });
    expect(refusals).toEqual([]);
  });

  it("does not raise it when there is no queue, so the two refusals never double up", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      pr: pr(),
      queue: undefined,
      repo: "acme/widget",
      requiredContexts: [],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("has no merge queue on");
  });

  it("is UNACKNOWLEDGEABLE — --acknowledge-all still refuses the press", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      args: args({ acknowledgeAll: true, reason: "landing it anyway" }),
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(verdict.disposition).toBe("refused");
    expect(verdict.lines.at(-1)).toContain("requires NO status-check contexts");
  });

  it("still lets --dequeue through, since leaving a queue only ever narrows what happens next", () => {
    const verdict = enqueueVerdict({
      target: ORDINARY,
      inspection: PAIRED,
      args: args({ dequeue: true }),
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } }),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    // The exact disposition, not merely "not refused": a regression to "already" would pass a negative
    // assertion while the dequeue silently stopped happening. Caught by a Codex review.
    expect(verdict.disposition).toBe("proceed");
  });

  it("names the gate on its own identity line, so an ungated queue is visible before any verdict", () => {
    const lines = enqueueIdentityLines({
      args: args(),
      target: ORDINARY,
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: [],
    });
    expect(lines.at(-1)).toBe("gated by:     NONE — the queue gates on nothing");
  });

  it("lists the contexts on that line when the queue does gate", () => {
    const lines = enqueueIdentityLines({
      args: args(),
      target: ORDINARY,
      pr: pr(),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: ["build", "integration"],
    });
    expect(lines.at(-1)).toBe("gated by:     build, integration");
  });

  it("names an advisory-only red under the gate line, so passing it over is never silent", () => {
    const lines = enqueueIdentityLines({
      args: args(),
      target: ORDINARY,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "e2e", state: "failed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
      }),
      queue: QUEUE,
      repo: "acme/widget",
      requiredContexts: ["build"],
    });
    expect(lines.slice(-2)).toEqual(["gated by:     build", "advisory red: e2e — outside what the queue gates on"]);
  });
});
