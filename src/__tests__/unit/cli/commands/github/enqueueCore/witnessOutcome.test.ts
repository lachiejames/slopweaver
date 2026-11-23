/* How the enqueue door confirms a press by reading the pull request back, and when it calls one UNCONFIRMED. */
import { describe, expect, it } from "vitest";

import { enqueueWitnessOutcome } from "../../../../../../cli/commands/github/enqueueCore.js";
import { ORDINARY, pr } from "./fixtures.js";

describe("enqueueWitnessOutcome", () => {
  it("confirms an enqueue by the entry it reads back", () => {
    const outcome = enqueueWitnessOutcome({
      target: ORDINARY,
      dequeue: false,
      pr: pr({ entry: { estimatedSecondsToMerge: 60, position: 2, state: "AWAITING_CHECKS" } }),
    });
    expect(outcome.failed).toBe(false);
    expect(outcome.lines[0]).toBe("queued #9 into main at position 2 (AWAITING_CHECKS)  https://example.invalid/pr/9");
  });

  it("reports an enqueue whose read-back shows no entry as UNCONFIRMED, never as success", () => {
    const outcome = enqueueWitnessOutcome({ target: ORDINARY, dequeue: false, pr: pr() });
    expect(outcome.failed).toBe(true);
    expect(outcome.lines[0]).toContain("UNCONFIRMED");
  });

  it("confirms a dequeue by the absence of an entry", () => {
    const outcome = enqueueWitnessOutcome({ target: ORDINARY, dequeue: true, pr: pr() });
    expect(outcome.failed).toBe(false);
    expect(outcome.lines[0]).toBe("dequeued #9 — it holds no queue entry now  https://example.invalid/pr/9");
  });

  it("reports a dequeue whose read-back still shows an entry as UNCONFIRMED", () => {
    const outcome = enqueueWitnessOutcome({
      target: ORDINARY,
      dequeue: true,
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } }),
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.lines[0]).toContain("still reads back at position 1 (QUEUED)");
  });
});

describe("enqueueWitnessOutcome refuses a lingering entry on a landed pull request", () => {
  it("reports UNCONFIRMED when the read-back is MERGED, however good its entry looks", () => {
    // GitHub can leave a mergeQueueEntry on a pull request that has already landed, and the asynchronous
    // stack path waits long enough for exactly that to happen. A Codex review's counterexample.
    const outcome = enqueueWitnessOutcome({
      dequeue: false,
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 4, state: "QUEUED" }, state: "MERGED" }),
      target: ORDINARY,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.lines).toStrictEqual([
      "UNCONFIRMED: #9 reads back MERGED rather than OPEN. Whatever queue entry it still carries, this " +
        "invocation did not witness it entering a queue — re-read it before retrying.",
    ]);
  });

  it("still reports a real queued entry on an OPEN pull request", () => {
    const outcome = enqueueWitnessOutcome({
      dequeue: false,
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 4, state: "QUEUED" } }),
      target: ORDINARY,
    });
    expect(outcome.failed).toBe(false);
    expect(outcome.lines[0]).toBe("queued #9 into main at position 4 (QUEUED)  https://example.invalid/pr/9");
  });
});
