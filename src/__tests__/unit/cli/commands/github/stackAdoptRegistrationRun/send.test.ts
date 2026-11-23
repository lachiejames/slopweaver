/*
 * The register-only native write and its read-back, called directly: a create that reads back as a confirmed
 * stack #5, and a create the provider failed, which is unconfirmed rather than refused.
 */
import { errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { RegistrationPlan } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import {
  confirmRegistration,
  sendRegistration,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationSend.js";
import { childPr, creatingApi, parentPr, unreachableApi } from "./fixtures.js";

/** A `create` of the pair 10 ← 100 in `o/r`, with nothing below the parent. */
function createPlan(): RegistrationPlan {
  return {
    facts: {
      child: childPr(),
      defaultBranch: "main",
      grandparent: undefined,
      owner: "o",
      parent: parentPr(),
      repo: "r",
    },
    operation: { kind: "create", pullRequests: [10, 100] },
    overrideNotices: [],
  };
}

describe("sendRegistration and confirmRegistration", () => {
  it("sends the create, pins stack #5, and confirms the membership it reads back", async () => {
    const calls: string[] = [];
    const api = creatingApi({ calls });
    const plan = createPlan();
    const sent = await sendRegistration({ api, plan });
    expect(sent.isOk()).toBe(true);
    expect(unwrap(sent)).toBe(5);
    const confirmed = await confirmRegistration({ api, expectedStackNumber: 5, plan });
    expect(confirmed.isOk()).toBe(true);
    expect(unwrap(confirmed)).toEqual({ childNumber: 100, entryNumbers: [10, 100], parentNumber: 10, stackNumber: 5 });
    expect(calls).toEqual(["createStack 10,100", "getStack 5"]);
  });

  it("reports a failed create as unconfirmed, naming the provider's own message", async () => {
    const api = unreachableApi({
      createStack: () => errAsync({ kind: "http" as const, message: "502 Bad Gateway", operation: "createStack" }),
    });
    const sent = await sendRegistration({ api, plan: createPlan() });
    expect(sent.isErr()).toBe(true);
    expect(unwrapErr(sent)).toEqual({
      kind: "unconfirmed",
      lines: [
        "native registration was attempted but its outcome is unknown: 502 Bad Gateway. No local " +
          "enrolment was written. Re-run to inspect current membership.",
      ],
    });
  });
});
