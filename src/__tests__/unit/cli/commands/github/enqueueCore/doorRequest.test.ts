/* The door request an enqueue or dequeue records: the pull request, the verb, and any waivers. */
import { describe, expect, it } from "vitest";

import { enqueueDoorRequest } from "../../../../../../cli/commands/github/enqueueCore.js";
import { args } from "./fixtures.js";

describe("enqueueDoorRequest", () => {
  it("names the exact pull request and the enqueue verb", () => {
    expect(enqueueDoorRequest({ acknowledgements: [], args: args(), home: "/tmp/home" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "enqueue" },
      artifact: { id: "acme/widget#9" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });

  it("distinguishes the dequeue direction in the recorded verb", () => {
    const request = enqueueDoorRequest({
      acknowledgements: [],
      args: args({ dequeue: true }),
      home: "/tmp/home",
    });
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "enqueue --dequeue" });
  });

  it("carries BOTH waivers onto the request, so the ledger row records each one", () => {
    const request = enqueueDoorRequest({
      acknowledgements: [
        { reason: "approved by a human reviewer", subject: "codex-loop-incomplete" },
        { reason: "replaced by run 33945158665", subject: "ci-rollup-superseded" },
      ],
      args: args(),
      home: "/tmp/home",
    });
    expect(request.acknowledgements).toEqual([
      { reason: "approved by a human reviewer", subject: "codex-loop-incomplete" },
      { reason: "replaced by run 33945158665", subject: "ci-rollup-superseded" },
    ]);
  });

  it("omits the key entirely when nothing was waived, so an unwaived row reads as one", () => {
    expect(
      Object.hasOwn(enqueueDoorRequest({ acknowledgements: [], args: args(), home: "/tmp/home" }), "acknowledgements"),
    ).toBe(false);
  });
});
