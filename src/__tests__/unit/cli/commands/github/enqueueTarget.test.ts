import { describe, expect, it } from "vitest";

import { enqueueScopeLines, enqueueTarget } from "../../../../../cli/commands/github/enqueueTarget.js";
import type { MergeQueuePrState, MergeQueueStackMembership } from "../../../../../live/github/mergeQueue.js";

/** Stack 16958 as GitHub reports it — the shape measured on `acme/acme-admin`. */
const STACK: MergeQueueStackMembership = { baseRefName: "staging", number: 16_958, position: 2, size: 3 };

/** A pull request whose only fields under test here are its base and its membership. */
function pr(over: Partial<MergeQueuePrState> = {}): MergeQueuePrState {
  return {
    approvedBy: [],
    baseRefName: "main",
    baseRefOid: "ba5e0000",
    body: "",
    checks: {
      baseRef: "main",
      checks: [],
      headSha: "cafe1234",
      mergeable: undefined,
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    codeownerRequests: [],
    codeownerRequestsTruncated: false,
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    entry: undefined,
    headOid: "cafe1234",
    headRefName: "feature",
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 16_338,
    reviewDecision: "APPROVED",
    stack: undefined,
    state: "OPEN",
    url: "https://example.invalid/pr/16338",
    ...over,
  };
}

describe("enqueueTarget", () => {
  it("points an ordinary pull request at its own base, over the GraphQL mutation", () => {
    expect(enqueueTarget({ pr: pr() })).toStrictEqual({ branch: "main", kind: "ordinary" });
  });

  it("points a mid-stack member at the STACK's base, not at the member below it", () => {
    // The measured case: a mid-stack member targets `mx-2386-onboarding-consent-invariant`, a branch with no queue at
    // all, while the stack lands on `staging`. Judging its own base would refuse it as ungated.
    const target = enqueueTarget({
      pr: pr({ baseRefName: "mx-2386-onboarding-consent-invariant", stack: STACK }),
    });
    expect(target).toStrictEqual({ branch: "staging", kind: "stack", stack: STACK });
  });

  it("still routes a BOTTOM member down the stack path, even though its base already IS the landing branch", () => {
    // The bottom member's base and its stack's base are both `staging`, and GraphQL refuses it anyway. Transport is a
    // property of membership, never of whether the two branches happen to agree.
    const target = enqueueTarget({
      pr: pr({ baseRefName: "staging", number: 16_378, stack: { ...STACK, position: 1 } }),
    });
    expect(target).toStrictEqual({ branch: "staging", kind: "stack", stack: { ...STACK, position: 1 } });
  });
});

describe("enqueueScopeLines", () => {
  it("says nothing extra about an ordinary pull request", () => {
    expect(
      enqueueScopeLines({
        dequeue: false,
        number: 9,
        prBaseRefName: "main",
        target: { branch: "main", kind: "ordinary" },
      }),
    ).toStrictEqual([]);
  });

  it("names the stack, the member's own base and everything the press also queues", () => {
    expect(
      enqueueScopeLines({
        dequeue: false,
        number: 16_338,
        prBaseRefName: "mx-2386-onboarding-consent-invariant",
        target: { branch: "staging", kind: "stack", stack: STACK },
      }),
    ).toStrictEqual([
      "stack:        #16958  position 2 of 3  landing on staging",
      "PR base:      mx-2386-onboarding-consent-invariant — the member below it, which is NOT where the stack lands",
      "scope:        #16338 and every unmerged pull request BELOW it in stack #16958 are requested together, bottom-up.",
    ]);
  });

  it("leaves the PR-base line out for a bottom member, whose base IS the landing branch", () => {
    expect(
      enqueueScopeLines({
        dequeue: false,
        number: 16_378,
        prBaseRefName: "staging",
        target: { branch: "staging", kind: "stack", stack: { ...STACK, position: 1 } },
      }),
    ).toStrictEqual([
      "stack:        #16958  position 1 of 3  landing on staging",
      "scope:        #16378 and every unmerged pull request BELOW it in stack #16958 are requested together, bottom-up.",
    ]);
  });

  it("warns that a dequeue cascades UPWARDS, which is the opposite direction from an enqueue", () => {
    const lines = enqueueScopeLines({
      dequeue: true,
      number: 16_338,
      prBaseRefName: "staging",
      target: { branch: "staging", kind: "stack", stack: STACK },
    });
    expect(lines.at(-1)).toBe("scope:        removing #16338 also removes every member ABOVE it in stack #16958.");
  });
});
