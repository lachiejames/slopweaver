/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import { githubStackAdoptRegistrationPlan } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrap } from "../../../../../../lib/result.js";
import { facts, planFor, pr, SELF } from "./harness.js";

describe("githubStackAdoptRegistrationPlan — the deadlock witness", () => {
  it("plans a create for the exact shape ordinary adopt refuses: eight commits, drifted, neither stacked", () => {
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: facts(),
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    const decision = unwrap(decided);
    expect(decision.kind).toBe("register");
    expect(planFor({ current: facts() }).operation).toEqual({ kind: "create", pullRequests: [10, 100] });
  });

  it("plans the same create whatever GitHub reports for commits, because no count is read", () => {
    const counts: readonly (number | undefined)[] = [undefined, 0, 1, 2, 8, 400];
    const operations = counts.map((commits) => planFor({ current: facts({ child: pr({ commits }) }) }).operation);
    expect(operations).toEqual(counts.map(() => ({ kind: "create", pullRequests: [10, 100] })));
  });
});
