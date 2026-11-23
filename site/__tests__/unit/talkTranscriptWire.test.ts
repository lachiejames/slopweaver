/*
 * The call transcript's wire edges: which batch the test instance marks, and which status a batch the verb did not
 * append answers with.
 */

import { describe, expect, it } from "vitest";

import { unappendedStatus, wireForInstance } from "../../lib/talkTranscript";

const CALL_A = "a0000041-0000-4000-8000-000000000044";

describe("wireForInstance", () => {
  it("marks every batch the test instance posts, and leaves the owner's page's batch exactly as it was", () => {
    const wire = { callId: CALL_A, lines: [] };
    expect(wireForInstance({ instance: "e2e", wire })).toStrictEqual({ callId: CALL_A, instance: "e2e", lines: [] });
    expect(wireForInstance({ instance: undefined, wire })).toStrictEqual({ callId: CALL_A, lines: [] });
  });
});

// A 422 drops the batch from the page, so only a batch the verb refused as malformed earns one.
describe("unappendedStatus", () => {
  it("answers 422 only for a batch the verb refused as malformed, and 503 for words that did not reach the disk", () => {
    expect([
      unappendedStatus({ exitCode: 2 }),
      unappendedStatus({ exitCode: 1 }),
      unappendedStatus({ exitCode: undefined }),
    ]).toEqual([422, 503, 503]);
  });
});
