/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import {
  githubStackAdoptNoRegistrationLine,
  githubStackAdoptRegistrationPlan,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrap } from "../../../../../../lib/result.js";
import { facts, pr, SELF } from "./harness.js";

describe("githubStackAdoptRegistrationPlan — the two legitimate no-ops", () => {
  it("registers nothing for a base that is the repository default", () => {
    const current = facts({ child: pr({ baseRef: "main" }), parent: undefined });
    const decision = unwrap(
      githubStackAdoptRegistrationPlan({ authorisation: SELF, facts: current, parentAuthorisation: SELF, viewerId: 1 }),
    );
    expect(decision).toEqual({ baseRef: "main", childNumber: 100, kind: "no-registration", reason: "default-base" });
    expect(githubStackAdoptNoRegistrationLine({ decision: decision as never })).toBe(
      "no registration: PR #100 is based on the repository default (main); no native membership or local " +
        "enrolment was written.",
    );
  });

  it("registers nothing when no open pull request has the base as its head", () => {
    const current = facts({ parent: undefined });
    const decision = unwrap(
      githubStackAdoptRegistrationPlan({ authorisation: SELF, facts: current, parentAuthorisation: SELF, viewerId: 1 }),
    );
    expect(decision).toEqual({
      baseRef: "parent-branch",
      childNumber: 100,
      kind: "no-registration",
      reason: "no-open-parent",
    });
    expect(githubStackAdoptNoRegistrationLine({ decision: decision as never })).toBe(
      "no registration: no open parent PR has head parent-branch; no native membership or local enrolment was " +
        "written.",
    );
  });
});
