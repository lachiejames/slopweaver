/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 *
 * What the split test files share: the child and parent pull requests (re-exported from the register-only run's
 * fixtures), the registration facts built from them, the plan those facts decide, and a native stack read-back.
 * Pure data, no I/O. Moved here when the one test file was split per describe.
 */
import {
  githubStackAdoptRegistrationPlan,
  type RegistrationFacts,
  type RegistrationPlan,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import type { Authorisation } from "../../../../../../cli/commands/github/updateCore.js";
import type { GithubStack } from "../../../../../../corpus/github/stack.js";
import { unwrap } from "../../../../../../lib/result.js";
import { parentPr, childPr as pr } from "../stackAdoptRegistrationRun/fixtures.js";

export const CHILD_SHA = "a".repeat(40);
export const PARENT_SHA = "b".repeat(40);
export const SELF: Authorisation = { kind: "self" };

// The child and parent pull requests are the register-only run's own builders: the same child on `child-branch`
// (head sha CHILD_SHA) and parent on `parent-branch` (head sha PARENT_SHA), so one copy serves both test folders.
export { parentPr, pr };

/**
 * The registration facts for the child onto the parent, with nothing below the parent.
 *
 * @returns the registration facts, with `overrides` spread last
 */
export function facts(overrides: Partial<RegistrationFacts> = {}): RegistrationFacts {
  return {
    child: pr(),
    defaultBranch: "main",
    grandparent: undefined,
    owner: "o",
    parent: parentPr(),
    repo: "r",
    ...overrides,
  };
}

/**
 * Decide a registration self-authorised on both pull requests, and unwrap the register decision's plan.
 * Every caller expects a register decision, so any other kind throws, naming the kind it got.
 *
 * @returns the plan the `current` facts decide
 */
export function planFor({ current }: { current: RegistrationFacts }): RegistrationPlan {
  const decided = githubStackAdoptRegistrationPlan({
    authorisation: SELF,
    facts: current,
    parentAuthorisation: SELF,
    viewerId: 1,
  });
  const decision = unwrap(decided);
  if (decision.kind !== "register") {
    throw new Error(`planFor expected a register decision, got ${decision.kind}`);
  }
  return decision.plan;
}

/**
 * A native stack read-back holding the given open entries, every one based on `main`.
 *
 * @returns the open native stack, its id seven times its number
 */
export function stackOf({ entries, number }: { entries: readonly number[]; number: number }): GithubStack {
  return {
    entries: entries.map((entry) => ({
      baseRef: "main",
      headRef: `branch-${String(entry)}`,
      mergedAtIso: undefined,
      number: entry,
      state: "open",
    })),
    id: number * 7,
    number,
    open: true,
  };
}
