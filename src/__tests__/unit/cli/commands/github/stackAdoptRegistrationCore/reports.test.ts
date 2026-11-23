/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import {
  type ConfirmedRegistration,
  githubStackAdoptRegistrationDoorRequest,
  githubStackAdoptRegistrationPreviewLine,
  githubStackAdoptRegistrationReportLines,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { facts, parentPr, planFor, pr } from "./harness.js";

describe("the reports", () => {
  it("previews each of the three operations", () => {
    expect(githubStackAdoptRegistrationPreviewLine({ plan: planFor({ current: facts() }) })).toBe(
      "would create native stack membership for entries [#10, #100], then enrol PR #100 locally after confirmation.",
    );
    const add = planFor({
      current: facts({ parent: parentPr({ stack: { id: 5, number: 5, position: 1, size: 1 } }) }),
    });
    expect(githubStackAdoptRegistrationPreviewLine({ plan: add })).toBe(
      "would add PR #100 to native stack #5, then enrol it locally after confirmation.",
    );
    const already = planFor({
      current: facts({
        child: pr({ stack: { id: 5, number: 5, position: 2, size: 2 } }),
        parent: parentPr({ stack: { id: 5, number: 5, position: 1, size: 2 } }),
      }),
    });
    expect(githubStackAdoptRegistrationPreviewLine({ plan: already })).toBe(
      "would confirm PR #100 and parent PR #10 in native stack #5, then enrol PR #100 locally; no native write " +
        "is planned.",
    );
  });

  it("states the residue: membership is not sync readiness and not pushability", () => {
    const confirmation: ConfirmedRegistration = {
      childNumber: 100,
      entryNumbers: [10, 100],
      parentNumber: 10,
      stackNumber: 5,
    };
    expect(githubStackAdoptRegistrationReportLines({ confirmation })).toEqual([
      "native membership confirmed: stack #5; entries [#10, #100].",
      "This registers membership only: the branch is not rebased; stack sync still cannot replay a multi-commit " +
        "entry; pushing the parent may now refuse on carry with entries above it (--orphan-above is the " +
        "existing route).",
    ]);
  });

  it("records the mode and no head SHA on the door request", () => {
    expect(githubStackAdoptRegistrationDoorRequest({ home: "/home", plan: planFor({ current: facts() }) })).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack adopt" },
      artifact: {
        baseBranch: "parent-branch",
        branch: "child-branch",
        mode: "register-only",
        operation: "create",
        parentNumber: 10,
        prNumber: 100,
        repo: "o/r",
      },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});
