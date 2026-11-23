/* The identity block the enqueue door prints first: the pull request, its head, the queue, the entry, the gate. */
import { describe, expect, it } from "vitest";

import { enqueueIdentityLines } from "../../../../../../cli/commands/github/enqueueCore.js";
import { args, ORDINARY, pr, QUEUE } from "./fixtures.js";

describe("enqueueIdentityLines", () => {
  it("names the pull request, the head, the queue, the entry and what gates it", () => {
    expect(
      enqueueIdentityLines({
        args: args(),
        target: ORDINARY,
        requiredContexts: ["build"],
        pr: pr(),
        queue: QUEUE,
        repo: "acme/widget",
      }),
    ).toEqual([
      "pull request: acme/widget#9  https://example.invalid/pr/9",
      "head:         cafe1234",
      "queue:        main  https://example.invalid/queue",
      "entry:        not queued",
      "gated by:     build",
    ]);
  });

  it("says the base has no queue rather than printing a blank one", () => {
    const lines = enqueueIdentityLines({
      args: args(),
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr(),
      queue: undefined,
      repo: "acme/widget",
    });
    expect(lines[2]).toBe("queue:        main has NO merge queue");
  });

  it("names the position and state of an existing entry", () => {
    const lines = enqueueIdentityLines({
      args: args(),
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr({ entry: { estimatedSecondsToMerge: undefined, position: 2, state: "QUEUED" } }),
      queue: QUEUE,
      repo: "acme/widget",
    });
    expect(lines[3]).toBe("entry:        position 2, state QUEUED");
  });
});
