import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseMergeQueueStack } from "../../../../live/github/mergeQueueStack.js";

const IDENTITY = "acme/widgets#7";

describe("parseMergeQueueStack", () => {
  it("reads an ordinary pull request, both selections null, as in no stack", () => {
    expect(unwrap(parseMergeQueueStack({ identity: IDENTITY, pullRequest: { stack: null, stackEntry: null } }))).toBe(
      undefined,
    );
  });

  it("reads a whole membership", () => {
    const pullRequest = { stack: { baseRefName: "main", number: 3, size: 4 }, stackEntry: { position: 2 } };

    expect(unwrap(parseMergeQueueStack({ identity: IDENTITY, pullRequest }))).toEqual({
      baseRefName: "main",
      number: 3,
      position: 2,
      size: 4,
    });
  });

  it("fails a half-populated stack rather than reading it as no stack", () => {
    const refused = unwrapErr(
      parseMergeQueueStack({ identity: IDENTITY, pullRequest: { stack: { number: 3 }, stackEntry: null } }),
    );

    expect(refused.code).toBe("READ_FAILED");
    expect(refused.message).toBe(
      "GitHub returned acme/widgets#7 with a half-populated native stack — stack present, stackEntry absent. " +
        "A membership this read cannot understand is never read as 'no stack'.",
    );
  });

  it("fails a membership missing its position", () => {
    const pullRequest = { stack: { baseRefName: "main", number: 3, size: 4 }, stackEntry: { position: 0 } };

    expect(unwrapErr(parseMergeQueueStack({ identity: IDENTITY, pullRequest })).message).toBe(
      "GitHub returned acme/widgets#7 inside a native stack without one of its number, baseRefName, size or the " +
        "pull request's own position",
    );
  });
});
